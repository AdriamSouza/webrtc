#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>

typedef void* gpointer;
typedef unsigned int guint;
typedef char gchar;
typedef unsigned char guint8;
typedef int gint;
typedef int gboolean;
typedef unsigned long long GType;

typedef struct _GstElement GstElement;
typedef struct _GstPipeline GstPipeline;
typedef struct _GstPromise GstPromise;
typedef struct _GstStructure GstStructure;
typedef struct _GstSDPMessage GstSDPMessage;
typedef struct _GMainLoop GMainLoop;
typedef struct _GMainContext GMainContext;

typedef struct _GstWebRTCSessionDescription {
    int type;
    GstSDPMessage *sdp;
} GstWebRTCSessionDescription;

typedef void (*GCallback)(void);
typedef void (*GstPromiseChangeFunc)(GstPromise *promise, gpointer user_data);
typedef gboolean (*GSourceFunc)(gpointer user_data);

typedef void (*t_gst_init)(int *argc, char ***argv);
typedef GstElement* (*t_gst_parse_launch)(const gchar *pipeline_description, void **error);
typedef int (*t_gst_element_set_state)(GstElement *element, int state);
typedef GstElement* (*t_gst_bin_get_by_name)(GstElement *bin, const gchar *name);
typedef unsigned long (*t_g_signal_connect_data)(gpointer instance, const gchar *detailed_signal, GCallback c_handler, gpointer data, void *destroy_data, int connect_flags);
typedef void (*t_g_signal_emit_by_name)(gpointer instance, const gchar *detailed_signal, ...);
typedef GstPromise* (*t_gst_promise_new_with_change_func)(GstPromiseChangeFunc func, gpointer user_data, void *notify);
typedef const GstStructure* (*t_gst_promise_get_reply)(GstPromise *promise);
typedef gboolean (*t_gst_structure_get)(const GstStructure *structure, const gchar *first_fieldname, ...);
typedef int (*t_gst_sdp_message_new)(GstSDPMessage **msg);
typedef int (*t_gst_sdp_message_parse_buffer)(const guint8 *data, guint size, GstSDPMessage *msg);
typedef gchar* (*t_gst_sdp_message_as_text)(const GstSDPMessage *msg);
typedef void (*t_gst_sdp_message_free)(GstSDPMessage *msg);
typedef GstWebRTCSessionDescription* (*t_gst_webrtc_session_description_new)(int type, GstSDPMessage *sdp);
typedef void (*t_gst_webrtc_session_description_free)(GstWebRTCSessionDescription *desc);
typedef GType (*t_gst_webrtc_session_description_get_type)(void);
typedef void (*t_g_free)(gpointer mem);
typedef GMainLoop* (*t_g_main_loop_new)(GMainContext *context, gboolean is_running);
typedef void (*t_g_main_loop_run)(GMainLoop *loop);
typedef void (*t_g_main_loop_quit)(GMainLoop *loop);
typedef guint (*t_g_idle_add)(GSourceFunc function, gpointer data);

static t_gst_init fn_gst_init;
static t_gst_parse_launch fn_gst_parse_launch;
static t_gst_element_set_state fn_gst_element_set_state;
static t_gst_bin_get_by_name fn_gst_bin_get_by_name;
static t_g_signal_connect_data fn_g_signal_connect_data;
static t_g_signal_emit_by_name fn_g_signal_emit_by_name;
static t_gst_promise_new_with_change_func fn_gst_promise_new;
static t_gst_promise_get_reply fn_gst_promise_get_reply;
static t_gst_structure_get fn_gst_structure_get;
static t_gst_sdp_message_new fn_gst_sdp_message_new;
static t_gst_sdp_message_parse_buffer fn_gst_sdp_message_parse_buffer;
static t_gst_sdp_message_as_text fn_gst_sdp_message_as_text;
static t_gst_sdp_message_free fn_gst_sdp_message_free;
static t_gst_webrtc_session_description_new fn_desc_new;
static t_gst_webrtc_session_description_free fn_desc_free;
static t_gst_webrtc_session_description_get_type fn_desc_get_type;
static t_g_free fn_g_free;
static t_g_main_loop_new fn_g_main_loop_new;
static t_g_main_loop_run fn_g_main_loop_run;
static t_g_main_loop_quit fn_g_main_loop_quit;
static t_g_idle_add fn_g_idle_add;

static GMainLoop *loop = NULL;
static GstElement *pipeline = NULL;
static GstElement *webrtc = NULL;
static CRITICAL_SECTION cs_out;

static void json_escape_print(const char *key, const char *str) {
    printf("\"%s\":\"", key);
    for (const char *p = str; *p; p++) {
        if (*p == '\\') printf("\\\\");
        else if (*p == '"') printf("\\\"");
        else if (*p == '\n') printf("\\n");
        else if (*p == '\r') printf("\\r");
        else if (*p == '\t') printf("\\t");
        else putchar(*p);
    }
    printf("\"");
}

static void on_offer_created(GstPromise *promise, gpointer user_data) {
    const GstStructure *reply = fn_gst_promise_get_reply(promise);
    GstWebRTCSessionDescription *offer = NULL;
    GType desc_type = fn_desc_get_type();
    fn_gst_structure_get(reply, "offer", desc_type, &offer, NULL);
    if (!offer || !offer->sdp) {
        EnterCriticalSection(&cs_out);
        printf("{\"type\":\"error\",\"message\":\"Failed to extract offer SDP\"}\n");
        fflush(stdout);
        LeaveCriticalSection(&cs_out);
        return;
    }

    // Set local description
    fn_g_signal_emit_by_name(webrtc, "set-local-description", offer, NULL);

    gchar *text = fn_gst_sdp_message_as_text(offer->sdp);
    if (text) {
        char *p = strstr(text, "profile-level-id=42042a");
        if (p) {
            memcpy(p + 17, "42e01f", 6);
        }
    }
    EnterCriticalSection(&cs_out);
    printf("{\"type\":\"offer\",");
    json_escape_print("sdp", text);
    printf("}\n");
    fflush(stdout);
    LeaveCriticalSection(&cs_out);

    fn_g_free(text);
}

static void on_negotiation_needed(GstElement *element, gpointer user_data) {
    GstPromise *promise = fn_gst_promise_new(on_offer_created, NULL, NULL);
    fn_g_signal_emit_by_name(webrtc, "create-offer", NULL, promise);
}

static void on_ice_candidate(GstElement *element, guint mline_index, gchar *candidate, gpointer user_data) {
    if (!candidate || !*candidate) return;
    EnterCriticalSection(&cs_out);
    printf("{\"type\":\"ice\",\"sdpMLineIndex\":%u,", mline_index);
    json_escape_print("candidate", candidate);
    printf("}\n");
    fflush(stdout);
    LeaveCriticalSection(&cs_out);
}

typedef struct {
    char *answer_sdp;
} MsgAnswer;

typedef struct {
    char *candidate;
    int mline_index;
} MsgIce;

static gboolean handle_answer_in_main(gpointer data) {
    MsgAnswer *msg = (MsgAnswer*)data;
    if (msg && msg->answer_sdp && webrtc) {
        GstSDPMessage *sdp = NULL;
        fn_gst_sdp_message_new(&sdp);
        int res = fn_gst_sdp_message_parse_buffer((const guint8*)msg->answer_sdp, strlen(msg->answer_sdp), sdp);
        if (res == 0) {
            GstWebRTCSessionDescription *desc = fn_desc_new(3 /* GST_WEBRTC_SDP_TYPE_ANSWER */, sdp);
            fn_g_signal_emit_by_name(webrtc, "set-remote-description", desc, NULL);
            EnterCriticalSection(&cs_out);
            printf("{\"type\":\"status\",\"message\":\"remote_answer_set\"}\n");
            fflush(stdout);
            LeaveCriticalSection(&cs_out);
        } else {
            EnterCriticalSection(&cs_out);
            printf("{\"type\":\"error\",\"message\":\"Failed to parse SDP answer\"}\n");
            fflush(stdout);
            LeaveCriticalSection(&cs_out);
        }
    }
    if (msg) {
        free(msg->answer_sdp);
        free(msg);
    }
    return FALSE;
}

static gboolean handle_ice_in_main(gpointer data) {
    MsgIce *msg = (MsgIce*)data;
    if (msg && msg->candidate && webrtc) {
        fn_g_signal_emit_by_name(webrtc, "add-ice-candidate", (guint)msg->mline_index, msg->candidate);
    }
    if (msg) {
        free(msg->candidate);
        free(msg);
    }
    return FALSE;
}

static gboolean handle_quit_in_main(gpointer data) {
    if (loop) {
        fn_g_main_loop_quit(loop);
    }
    return FALSE;
}

static char* extract_json_string(const char *json, const char *key) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\":\"", key);
    char *start = strstr(json, pattern);
    if (!start) return NULL;
    start += strlen(pattern);

    size_t cap = 4096;
    char *buf = (char*)malloc(cap);
    size_t len = 0;

    for (const char *p = start; *p; p++) {
        if (*p == '"') {
            break;
        } else if (*p == '\\' && *(p+1)) {
            p++;
            if (*p == 'n') buf[len++] = '\n';
            else if (*p == 'r') buf[len++] = '\r';
            else if (*p == 't') buf[len++] = '\t';
            else buf[len++] = *p;
        } else {
            buf[len++] = *p;
        }
        if (len + 4 >= cap) {
            cap *= 2;
            buf = (char*)realloc(buf, cap);
        }
    }
    buf[len] = '\0';
    return buf;
}

static int extract_json_int(const char *json, const char *key, int default_val) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\":", key);
    char *start = strstr(json, pattern);
    if (!start) return default_val;
    start += strlen(pattern);
    while (*start == ' ' || *start == '\t') start++;
    return atoi(start);
}

static gboolean handle_create_offer_in_main(gpointer data) {
    if (webrtc) {
        GstPromise *promise = fn_gst_promise_new(on_offer_created, NULL, NULL);
        fn_g_signal_emit_by_name(webrtc, "create-offer", NULL, promise);
    }
    return FALSE;
}

static DWORD WINAPI StdinThread(LPVOID lpParam) {
    char line[65536];
    while (fgets(line, sizeof(line), stdin)) {
        size_t l = strlen(line);
        while (l > 0 && (line[l-1] == '\r' || line[l-1] == '\n')) line[--l] = '\0';
        if (l == 0) continue;

        if (strstr(line, "\"type\":\"createOffer\"") || strstr(line, "\"type\": \"createOffer\"")) {
            fn_g_idle_add(handle_create_offer_in_main, NULL);
        } else if (strstr(line, "\"type\":\"answer\"") || strstr(line, "\"type\": \"answer\"")) {
            char *sdp = extract_json_string(line, "sdp");
            if (sdp) {
                MsgAnswer *msg = (MsgAnswer*)malloc(sizeof(MsgAnswer));
                msg->answer_sdp = sdp;
                fn_g_idle_add(handle_answer_in_main, msg);
            }
        } else if (strstr(line, "\"type\":\"ice\"") || strstr(line, "\"type\": \"ice\"")) {
            char *cand = extract_json_string(line, "candidate");
            int mline = extract_json_int(line, "sdpMLineIndex", 0);
            if (cand) {
                MsgIce *msg = (MsgIce*)malloc(sizeof(MsgIce));
                msg->candidate = cand;
                msg->mline_index = mline;
                fn_g_idle_add(handle_ice_in_main, msg);
            }
        } else if (strstr(line, "\"type\":\"quit\"") || strstr(line, "\"type\": \"quit\"")) {
            fn_g_idle_add(handle_quit_in_main, NULL);
            break;
        }
    }
    return 0;
}

int main(int argc, char *argv[]) {
    setvbuf(stdout, NULL, _IONBF, 0);
    InitializeCriticalSection(&cs_out);

    HMODULE hGst = LoadLibraryA("gstreamer-1.0-0.dll");
    HMODULE hGObject = LoadLibraryA("gobject-2.0-0.dll");
    HMODULE hGLib = LoadLibraryA("glib-2.0-0.dll");
    HMODULE hSdp = LoadLibraryA("gstsdp-1.0-0.dll");
    HMODULE hWebRtc = LoadLibraryA("gstwebrtc-1.0-0.dll");

    if (!hGst || !hGObject || !hGLib || !hSdp || !hWebRtc) {
        printf("{\"type\":\"error\",\"message\":\"Failed to load GStreamer DLLs from PATH\"}\n");
        return 1;
    }

    fn_gst_init = (t_gst_init)GetProcAddress(hGst, "gst_init");
    fn_gst_parse_launch = (t_gst_parse_launch)GetProcAddress(hGst, "gst_parse_launch");
    fn_gst_element_set_state = (t_gst_element_set_state)GetProcAddress(hGst, "gst_element_set_state");
    fn_gst_bin_get_by_name = (t_gst_bin_get_by_name)GetProcAddress(hGst, "gst_bin_get_by_name");
    fn_gst_promise_new = (t_gst_promise_new_with_change_func)GetProcAddress(hGst, "gst_promise_new_with_change_func");
    fn_gst_promise_get_reply = (t_gst_promise_get_reply)GetProcAddress(hGst, "gst_promise_get_reply");
    fn_gst_structure_get = (t_gst_structure_get)GetProcAddress(hGst, "gst_structure_get");

    fn_g_signal_connect_data = (t_g_signal_connect_data)GetProcAddress(hGObject, "g_signal_connect_data");
    fn_g_signal_emit_by_name = (t_g_signal_emit_by_name)GetProcAddress(hGObject, "g_signal_emit_by_name");

    fn_g_free = (t_g_free)GetProcAddress(hGLib, "g_free");
    fn_g_main_loop_new = (t_g_main_loop_new)GetProcAddress(hGLib, "g_main_loop_new");
    fn_g_main_loop_run = (t_g_main_loop_run)GetProcAddress(hGLib, "g_main_loop_run");
    fn_g_main_loop_quit = (t_g_main_loop_quit)GetProcAddress(hGLib, "g_main_loop_quit");
    fn_g_idle_add = (t_g_idle_add)GetProcAddress(hGLib, "g_idle_add");

    fn_gst_sdp_message_new = (t_gst_sdp_message_new)GetProcAddress(hSdp, "gst_sdp_message_new");
    fn_gst_sdp_message_parse_buffer = (t_gst_sdp_message_parse_buffer)GetProcAddress(hSdp, "gst_sdp_message_parse_buffer");
    fn_gst_sdp_message_as_text = (t_gst_sdp_message_as_text)GetProcAddress(hSdp, "gst_sdp_message_as_text");
    fn_gst_sdp_message_free = (t_gst_sdp_message_free)GetProcAddress(hSdp, "gst_sdp_message_free");

    fn_desc_new = (t_gst_webrtc_session_description_new)GetProcAddress(hWebRtc, "gst_webrtc_session_description_new");
    fn_desc_free = (t_gst_webrtc_session_description_free)GetProcAddress(hWebRtc, "gst_webrtc_session_description_free");
    fn_desc_get_type = (t_gst_webrtc_session_description_get_type)GetProcAddress(hWebRtc, "gst_webrtc_session_description_get_type");

    fn_gst_init(NULL, NULL);
    loop = fn_g_main_loop_new(NULL, 0);

    const char *pipe_desc = 
        "d3d11screencapturesrc capture-api=wgc show-cursor=true do-timestamp=true ! "
        "videorate skip-to-first=true ! "
        "video/x-raw(memory:D3D11Memory),framerate=60/1 ! "
        "d3d11convert ! "
        "video/x-raw(memory:D3D11Memory),format=NV12,width=1920,height=1080,framerate=60/1 ! "
        "amfh264enc name=enc usage=low-latency rate-control=cbr bitrate=10000 max-bitrate=10000 gop-size=120 b-frames=0 preset=speed ! "
        "video/x-h264,profile=constrained-baseline ! "
        "h264parse config-interval=-1 ! "
        "rtph264pay config-interval=-1 aggregate-mode=zero-latency pt=96 ! "
        "application/x-rtp,media=video,encoding-name=H264,payload=96 ! "
        "wb. webrtcbin name=wb bundle-policy=max-bundle stun-server=stun://stun.l.google.com:19302";

    void *err = NULL;
    pipeline = fn_gst_parse_launch(pipe_desc, &err);
    if (!pipeline) {
        printf("{\"type\":\"error\",\"message\":\"Failed to parse pipeline\"}\n");
        return 1;
    }

    webrtc = fn_gst_bin_get_by_name(pipeline, "wb");
    fn_g_signal_connect_data(webrtc, "on-negotiation-needed", (GCallback)on_negotiation_needed, NULL, NULL, 0);
    fn_g_signal_connect_data(webrtc, "on-ice-candidate", (GCallback)on_ice_candidate, NULL, NULL, 0);

    // Notify ready with PID
    EnterCriticalSection(&cs_out);
    printf("{\"type\":\"ready\",\"pid\":%lu}\n", GetCurrentProcessId());
    fflush(stdout);
    LeaveCriticalSection(&cs_out);

    // Start stdin reader thread
    HANDLE hThread = CreateThread(NULL, 0, StdinThread, NULL, 0, NULL);

    // Start pipeline
    fn_gst_element_set_state(pipeline, 4 /* GST_STATE_PLAYING */);

    // Run GLib event loop
    fn_g_main_loop_run(loop);

    // Cleanup
    fn_gst_element_set_state(pipeline, 1 /* GST_STATE_NULL */);
    if (hThread) CloseHandle(hThread);
    DeleteCriticalSection(&cs_out);
    return 0;
}
