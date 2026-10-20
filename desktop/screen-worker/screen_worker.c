#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>

#define MAX_PEER_SLOTS 8

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
typedef void (*t_g_object_set)(gpointer object, const gchar *first_property_name, ...);
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
static t_g_object_set fn_g_object_set;
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

typedef struct {
    int slot_index;
    int is_active;
    char peer_id[128];
    GstElement *webrtc;
} PeerSlot;

static GMainLoop *loop = NULL;
static GstElement *pipeline = NULL;
static GstElement *encoder = NULL;
static PeerSlot slots[MAX_PEER_SLOTS];
static CRITICAL_SECTION cs_out;
static CRITICAL_SECTION cs_slots;

static void json_escape_print(const char *key, const char *str) {
    printf("\"%s\":\"", key);
    if (str) {
        for (const char *p = str; *p; p++) {
            if (*p == '\\') printf("\\\\");
            else if (*p == '"') printf("\\\"");
            else if (*p == '\n') printf("\\n");
            else if (*p == '\r') printf("\\r");
            else if (*p == '\t') printf("\\t");
            else putchar(*p);
        }
    }
    printf("\"");
}

static PeerSlot* find_slot_by_peer(const char *peer_id) {
    EnterCriticalSection(&cs_slots);
    for (int i = 0; i < MAX_PEER_SLOTS; i++) {
        if (slots[i].is_active && strcmp(slots[i].peer_id, peer_id) == 0) {
            LeaveCriticalSection(&cs_slots);
            return &slots[i];
        }
    }
    LeaveCriticalSection(&cs_slots);
    return NULL;
}

static PeerSlot* allocate_slot_for_peer(const char *peer_id) {
    EnterCriticalSection(&cs_slots);
    // If already exists, return it
    for (int i = 0; i < MAX_PEER_SLOTS; i++) {
        if (slots[i].is_active && strcmp(slots[i].peer_id, peer_id) == 0) {
            LeaveCriticalSection(&cs_slots);
            return &slots[i];
        }
    }
    // Find free slot
    for (int i = 0; i < MAX_PEER_SLOTS; i++) {
        if (!slots[i].is_active) {
            slots[i].is_active = 1;
            strncpy(slots[i].peer_id, peer_id, sizeof(slots[i].peer_id) - 1);
            slots[i].peer_id[sizeof(slots[i].peer_id) - 1] = '\0';
            LeaveCriticalSection(&cs_slots);
            return &slots[i];
        }
    }
    LeaveCriticalSection(&cs_slots);
    return NULL;
}

static void release_slot_by_peer(const char *peer_id) {
    EnterCriticalSection(&cs_slots);
    for (int i = 0; i < MAX_PEER_SLOTS; i++) {
        if (slots[i].is_active && strcmp(slots[i].peer_id, peer_id) == 0) {
            slots[i].is_active = 0;
            slots[i].peer_id[0] = '\0';
            break;
        }
    }
    LeaveCriticalSection(&cs_slots);
}

static DWORD parent_pid = 0;

static DWORD WINAPI ParentWatchdogThread(LPVOID lpParam) {
    if (parent_pid == 0) return 0;
    HANDLE hParent = OpenProcess(SYNCHRONIZE, FALSE, parent_pid);
    if (!hParent) {
        ExitProcess(0);
        return 0;
    }
    WaitForSingleObject(hParent, INFINITE);
    CloseHandle(hParent);
    ExitProcess(0);
    return 0;
}

static void on_offer_created(GstPromise *promise, gpointer user_data) {
    PeerSlot *slot = (PeerSlot*)user_data;
    if (!slot || !slot->webrtc) return;

    const GstStructure *reply = fn_gst_promise_get_reply(promise);
    GstWebRTCSessionDescription *offer = NULL;
    GType desc_type = fn_desc_get_type();
    fn_gst_structure_get(reply, "offer", desc_type, &offer, NULL);
    if (!offer || !offer->sdp) {
        EnterCriticalSection(&cs_out);
        printf("{\"type\":\"error\",\"peerId\":\"%s\",\"message\":\"Failed to extract offer SDP\"}\n", slot->peer_id);
        fflush(stdout);
        LeaveCriticalSection(&cs_out);
        return;
    }

    // Set local description
    fn_g_signal_emit_by_name(slot->webrtc, "set-local-description", offer, NULL);

    gchar *text = fn_gst_sdp_message_as_text(offer->sdp);
    if (text) {
        // Rewrite profile-level-id to 42e033 (Constrained Baseline Level 5.1) for Chromium HW decode compatibility up to 1440p60
        char *p = strstr(text, "profile-level-id=42042a");
        if (p) {
            memcpy(p + 17, "42e033", 6);
        }
        char *p2 = strstr(text, "profile-level-id=4d042a");
        if (p2) {
            memcpy(p2 + 17, "42e033", 6);
        }
        char *p3 = strstr(text, "profile-level-id=42e01f");
        if (p3) {
            memcpy(p3 + 17, "42e033", 6);
        }
    }

    EnterCriticalSection(&cs_out);
    printf("{\"type\":\"offer\",\"peerId\":\"%s\",", slot->peer_id);
    json_escape_print("sdp", text);
    printf("}\n");
    fflush(stdout);
    LeaveCriticalSection(&cs_out);

    if (text) fn_g_free(text);
}

static void on_ice_candidate(GstElement *element, guint mline_index, gchar *candidate, gpointer user_data) {
    PeerSlot *slot = (PeerSlot*)user_data;
    if (!slot || !candidate || !*candidate) return;

    EnterCriticalSection(&cs_out);
    printf("{\"type\":\"ice\",\"peerId\":\"%s\",\"sdpMLineIndex\":%u,", slot->peer_id, mline_index);
    json_escape_print("candidate", candidate);
    printf("}\n");
    fflush(stdout);
    LeaveCriticalSection(&cs_out);
}

typedef struct {
    char peer_id[128];
    char *answer_sdp;
} MsgAnswer;

typedef struct {
    char peer_id[128];
    char *candidate;
    int mline_index;
} MsgIce;

typedef struct {
    char peer_id[128];
} MsgPeer;

static gboolean handle_create_offer_in_main(gpointer data) {
    MsgPeer *msg = (MsgPeer*)data;
    if (msg) {
        PeerSlot *slot = allocate_slot_for_peer(msg->peer_id);
        if (slot && slot->webrtc) {
            GstPromise *promise = fn_gst_promise_new(on_offer_created, slot, NULL);
            fn_g_signal_emit_by_name(slot->webrtc, "create-offer", NULL, promise);
        } else {
            EnterCriticalSection(&cs_out);
            printf("{\"type\":\"error\",\"peerId\":\"%s\",\"message\":\"No available slot for peer\"}\n", msg->peer_id);
            fflush(stdout);
            LeaveCriticalSection(&cs_out);
        }
        free(msg);
    }
    return FALSE;
}

static gboolean handle_answer_in_main(gpointer data) {
    MsgAnswer *msg = (MsgAnswer*)data;
    if (msg && msg->answer_sdp) {
        PeerSlot *slot = find_slot_by_peer(msg->peer_id);
        if (slot && slot->webrtc) {
            GstSDPMessage *sdp = NULL;
            fn_gst_sdp_message_new(&sdp);
            int res = fn_gst_sdp_message_parse_buffer((const guint8*)msg->answer_sdp, strlen(msg->answer_sdp), sdp);
            if (res == 0) {
                GstWebRTCSessionDescription *desc = fn_desc_new(3 /* GST_WEBRTC_SDP_TYPE_ANSWER */, sdp);
                fn_g_signal_emit_by_name(slot->webrtc, "set-remote-description", desc, NULL);
                EnterCriticalSection(&cs_out);
                printf("{\"type\":\"status\",\"peerId\":\"%s\",\"message\":\"remote_answer_set\"}\n", msg->peer_id);
                fflush(stdout);
                LeaveCriticalSection(&cs_out);
            } else {
                EnterCriticalSection(&cs_out);
                printf("{\"type\":\"error\",\"peerId\":\"%s\",\"message\":\"Failed to parse SDP answer\"}\n", msg->peer_id);
                fflush(stdout);
                LeaveCriticalSection(&cs_out);
            }
        }
        free(msg->answer_sdp);
        free(msg);
    }
    return FALSE;
}

static gboolean handle_ice_in_main(gpointer data) {
    MsgIce *msg = (MsgIce*)data;
    if (msg && msg->candidate) {
        PeerSlot *slot = find_slot_by_peer(msg->peer_id);
        if (slot && slot->webrtc) {
            fn_g_signal_emit_by_name(slot->webrtc, "add-ice-candidate", (guint)msg->mline_index, msg->candidate);
        }
        free(msg->candidate);
        free(msg);
    }
    return FALSE;
}

static gboolean handle_remove_peer_in_main(gpointer data) {
    MsgPeer *msg = (MsgPeer*)data;
    if (msg) {
        release_slot_by_peer(msg->peer_id);
        EnterCriticalSection(&cs_out);
        printf("{\"type\":\"status\",\"peerId\":\"%s\",\"message\":\"peer_removed\"}\n", msg->peer_id);
        fflush(stdout);
        LeaveCriticalSection(&cs_out);
        free(msg);
    }
    return FALSE;
}

static gboolean handle_set_bitrate_in_main(gpointer data) {
    int kbps = (int)(intptr_t)data;
    if (encoder && fn_g_object_set && kbps > 0) {
        fn_g_object_set(encoder, "bitrate", (guint)kbps, "max-bitrate", (guint)kbps, NULL);
        EnterCriticalSection(&cs_out);
        printf("{\"type\":\"status\",\"message\":\"bitrate_updated\",\"bitrate\":%d}\n", kbps);
        fflush(stdout);
        LeaveCriticalSection(&cs_out);
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

static DWORD WINAPI StdinThread(LPVOID lpParam) {
    char line[65536];
    while (fgets(line, sizeof(line), stdin)) {
        size_t l = strlen(line);
        while (l > 0 && (line[l-1] == '\r' || line[l-1] == '\n')) line[--l] = '\0';
        if (l == 0) continue;

        if (strstr(line, "\"createOffer\"")) {
            char *peer_id = extract_json_string(line, "peerId");
            if (peer_id) {
                MsgPeer *msg = (MsgPeer*)malloc(sizeof(MsgPeer));
                strncpy(msg->peer_id, peer_id, sizeof(msg->peer_id) - 1);
                msg->peer_id[sizeof(msg->peer_id) - 1] = '\0';
                free(peer_id);
                fn_g_idle_add(handle_create_offer_in_main, msg);
            }
        } else if (strstr(line, "\"answer\"")) {
            char *peer_id = extract_json_string(line, "peerId");
            char *sdp = extract_json_string(line, "sdp");
            if (peer_id && sdp) {
                MsgAnswer *msg = (MsgAnswer*)malloc(sizeof(MsgAnswer));
                strncpy(msg->peer_id, peer_id, sizeof(msg->peer_id) - 1);
                msg->peer_id[sizeof(msg->peer_id) - 1] = '\0';
                msg->answer_sdp = sdp;
                free(peer_id);
                fn_g_idle_add(handle_answer_in_main, msg);
            } else {
                if (peer_id) free(peer_id);
                if (sdp) free(sdp);
            }
        } else if (strstr(line, "\"ice\"")) {
            char *peer_id = extract_json_string(line, "peerId");
            char *cand = extract_json_string(line, "candidate");
            int mline = extract_json_int(line, "sdpMLineIndex", 0);
            if (peer_id && cand) {
                MsgIce *msg = (MsgIce*)malloc(sizeof(MsgIce));
                strncpy(msg->peer_id, peer_id, sizeof(msg->peer_id) - 1);
                msg->peer_id[sizeof(msg->peer_id) - 1] = '\0';
                msg->candidate = cand;
                msg->mline_index = mline;
                free(peer_id);
                fn_g_idle_add(handle_ice_in_main, msg);
            } else {
                if (peer_id) free(peer_id);
                if (cand) free(cand);
            }
        } else if (strstr(line, "\"removePeer\"")) {
            char *peer_id = extract_json_string(line, "peerId");
            if (peer_id) {
                MsgPeer *msg = (MsgPeer*)malloc(sizeof(MsgPeer));
                strncpy(msg->peer_id, peer_id, sizeof(msg->peer_id) - 1);
                msg->peer_id[sizeof(msg->peer_id) - 1] = '\0';
                free(peer_id);
                fn_g_idle_add(handle_remove_peer_in_main, msg);
            }
        } else if (strstr(line, "\"setBitrate\"")) {
            int bitrate = extract_json_int(line, "bitrate", 10000);
            fn_g_idle_add(handle_set_bitrate_in_main, (gpointer)(intptr_t)bitrate);
        } else if (strstr(line, "\"quit\"")) {
            fn_g_idle_add(handle_quit_in_main, NULL);
            break;
        }
    }
    // If stdin closed (parent exited), gracefully quit loop
    fn_g_idle_add(handle_quit_in_main, NULL);
    return 0;
}

static const char* get_cmd_arg(int argc, char *argv[], const char *flag, const char *default_val) {
    for (int i = 1; i < argc - 1; i++) {
        if (strcmp(argv[i], flag) == 0) {
            return argv[i + 1];
        }
    }
    return default_val;
}

static int get_cmd_arg_int(int argc, char *argv[], const char *flag, int default_val) {
    const char *val = get_cmd_arg(argc, argv, flag, NULL);
    if (val) return atoi(val);
    return default_val;
}

int main(int argc, char *argv[]) {
    setvbuf(stdout, NULL, _IONBF, 0);
    InitializeCriticalSection(&cs_out);
    InitializeCriticalSection(&cs_slots);

    int width = get_cmd_arg_int(argc, argv, "--width", 1920);
    int height = get_cmd_arg_int(argc, argv, "--height", 1080);
    int fps = get_cmd_arg_int(argc, argv, "--fps", 60);
    int bitrate = get_cmd_arg_int(argc, argv, "--bitrate", 10000);
    int monitor_idx = get_cmd_arg_int(argc, argv, "--monitor-index", -1);
    const char *codec = get_cmd_arg(argc, argv, "--codec", "h264");
    const char *usage_profile = get_cmd_arg(argc, argv, "--usage-profile", "low-latency");
    const char *adapter_luid_str = get_cmd_arg(argc, argv, "--adapter-luid", NULL);
    parent_pid = (DWORD)get_cmd_arg_int(argc, argv, "--parent-pid", 0);

    if (parent_pid > 0) {
        CreateThread(NULL, 0, ParentWatchdogThread, NULL, 0, NULL);
    }

    memset(slots, 0, sizeof(slots));
    for (int i = 0; i < MAX_PEER_SLOTS; i++) {
        slots[i].slot_index = i;
    }

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
    fn_g_object_set = (t_g_object_set)GetProcAddress(hGObject, "g_object_set");

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

    const char *amf_usage = "ultra-low-latency";
    const char *amf_rate_control = "cbr";
    const char *amf_preset = "speed";
    if (strcmp(usage_profile, "balanced") == 0) {
        amf_usage = "low-latency";
        amf_rate_control = "cbr";
        amf_preset = "balanced";
    } else if (strcmp(usage_profile, "quality") == 0) {
        amf_usage = "transcoding";
        amf_rate_control = "cbr";
        amf_preset = "quality";
    }

    char capture_opts[256];
    if (monitor_idx >= 0) {
        snprintf(capture_opts, sizeof(capture_opts), "capture-api=wgc show-cursor=true do-timestamp=true monitor-index=%d", monitor_idx);
    } else {
        snprintf(capture_opts, sizeof(capture_opts), "capture-api=wgc show-cursor=true do-timestamp=true");
    }

    char enc_desc[2048];
    const char *rtp_encoding_name = "H264";
    if (strcmp(codec, "av1") == 0) {
        rtp_encoding_name = "AV1";
        if (adapter_luid_str) {
            snprintf(enc_desc, sizeof(enc_desc),
                "amfav1enc name=enc usage=%s rate-control=%s bitrate=%d max-bitrate=%d gop-size=%d preset=%s adapter-luid=%s ! "
                "av1parse ! "
                "rtpav1pay pt=96 ! ",
                amf_usage, amf_rate_control, bitrate, bitrate, fps, amf_preset, adapter_luid_str
            );
        } else {
            snprintf(enc_desc, sizeof(enc_desc),
                "amfav1enc name=enc usage=%s rate-control=%s bitrate=%d max-bitrate=%d gop-size=%d preset=%s ! "
                "av1parse ! "
                "rtpav1pay pt=96 ! ",
                amf_usage, amf_rate_control, bitrate, bitrate, fps, amf_preset
            );
        }
    } else {
        rtp_encoding_name = "H264";
        if (adapter_luid_str) {
            snprintf(enc_desc, sizeof(enc_desc),
                "amfh264enc name=enc usage=%s rate-control=%s bitrate=%d max-bitrate=%d gop-size=%d b-frames=0 preset=%s min-force-key-unit-interval=500000000 adapter-luid=%s ! "
                "video/x-h264,profile=constrained-baseline ! "
                "h264parse config-interval=-1 ! "
                "rtph264pay config-interval=-1 aggregate-mode=zero-latency pt=96 ! ",
                amf_usage, amf_rate_control, bitrate, bitrate, fps, amf_preset, adapter_luid_str
            );
        } else {
            snprintf(enc_desc, sizeof(enc_desc),
                "amfh264enc name=enc usage=%s rate-control=%s bitrate=%d max-bitrate=%d gop-size=%d b-frames=0 preset=%s min-force-key-unit-interval=500000000 ! "
                "video/x-h264,profile=constrained-baseline ! "
                "h264parse config-interval=-1 ! "
                "rtph264pay config-interval=-1 aggregate-mode=zero-latency pt=96 ! ",
                amf_usage, amf_rate_control, bitrate, bitrate, fps, amf_preset
            );
        }
    }

    char pipe_desc[16384];
    int offset = snprintf(pipe_desc, sizeof(pipe_desc),
        "d3d11screencapturesrc %s ! "
        "videorate skip-to-first=true ! "
        "video/x-raw(memory:D3D11Memory),framerate=%d/1 ! "
        "d3d11convert ! "
        "video/x-raw(memory:D3D11Memory),format=NV12,width=%d,height=%d,framerate=%d/1 ! "
        "%s"
        "tee name=t ",
        capture_opts, fps, width, height, fps, enc_desc
    );

    for (int i = 0; i < MAX_PEER_SLOTS; i++) {
        offset += snprintf(pipe_desc + offset, sizeof(pipe_desc) - offset,
            "t. ! queue leaky=downstream max-size-buffers=0 max-size-time=200000000 max-size-bytes=0 ! "
            "application/x-rtp,media=video,encoding-name=%s,payload=96 ! "
            "webrtcbin name=wb%d bundle-policy=max-bundle stun-server=stun://stun.l.google.com:19302 ",
            rtp_encoding_name, i
        );
    }

    void *err = NULL;
    pipeline = fn_gst_parse_launch(pipe_desc, &err);
    if (!pipeline) {
        printf("{\"type\":\"error\",\"message\":\"Failed to parse multi-peer pipeline\"}\n");
        return 1;
    }

    encoder = fn_gst_bin_get_by_name(pipeline, "enc");

    for (int i = 0; i < MAX_PEER_SLOTS; i++) {
        char name[16];
        snprintf(name, sizeof(name), "wb%d", i);
        slots[i].webrtc = fn_gst_bin_get_by_name(pipeline, name);
        if (slots[i].webrtc) {
            fn_g_signal_connect_data(slots[i].webrtc, "on-ice-candidate", (GCallback)on_ice_candidate, &slots[i], NULL, 0);
        }
    }

    // Notify ready with PID
    EnterCriticalSection(&cs_out);
    printf("{\"type\":\"ready\",\"pid\":%lu,\"slots\":%d}\n", GetCurrentProcessId(), MAX_PEER_SLOTS);
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
    DeleteCriticalSection(&cs_slots);
    DeleteCriticalSection(&cs_out);
    return 0;
}
