using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace AudioSessionHelper {
    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject { }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator {
        [PreserveSig]
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
        [PreserveSig]
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    }

    [ComImport]
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceCollection {
        [PreserveSig]
        int GetCount(out uint pcDevices);
        [PreserveSig]
        int Item(uint nDevice, out IMMDevice ppDevice);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice {
        [PreserveSig]
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [ComImport]
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionManager2 {
        int GetAudioSessionControl(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr SessionControl);
        int GetSimpleAudioVolume(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr AudioVolume);
        [PreserveSig]
        int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionEnumerator {
        [PreserveSig]
        int GetCount(out int SessionCount);
        [PreserveSig]
        int GetSession(int SessionIndex, [MarshalAs(UnmanagedType.IUnknown)] out object Session);
    }

    [ComImport]
    [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl2 {
        [PreserveSig]
        int GetState(out int pRetVal);
        [PreserveSig]
        int GetDisplayName(out IntPtr pRetVal);
        [PreserveSig]
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        [PreserveSig]
        int GetIconPath(out IntPtr pRetVal);
        [PreserveSig]
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        [PreserveSig]
        int GetGroupingParam(out Guid pRetVal);
        [PreserveSig]
        int SetGroupingParam(ref Guid Override, ref Guid EventContext);
        [PreserveSig]
        int RegisterAudioSessionNotification(IntPtr Client);
        [PreserveSig]
        int UnregisterAudioSessionNotification(IntPtr Client);

        [PreserveSig]
        int GetSessionIdentifier(out IntPtr pRetVal);
        [PreserveSig]
        int GetSessionInstanceIdentifier(out IntPtr pRetVal);
        [PreserveSig]
        int GetProcessId(out uint pRetVal);
        [PreserveSig]
        int IsSystemSoundsSession();
        [PreserveSig]
        int SetDuckingPreference(bool optOut);
    }

    [ComImport]
    [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioMeterInformation {
        [PreserveSig]
        int GetPeakValue(out float pfPeak);
        [PreserveSig]
        int GetMeteringChannelCount(out uint pnChannelCount);
    }

    public class AppAudioInfo {
        public uint pid;
        public uint rootPid;
        public string processName;
        public string displayName;
        public string windowTitle;
        public string exePath;
        public int state; // 0 = Inactive, 1 = Active, 2 = Expired
        public float peak;
    }

    class Program {
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(int dwDesiredAccess, bool bInheritHandle, int dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern bool QueryFullProcessImageName(IntPtr hProcess, int dwFlags, StringBuilder lpExeName, ref int lpdwSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr hObject);

        const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        static string GetProcessPath(int pid) {
            IntPtr hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hProc == IntPtr.Zero) return null;
            try {
                var sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (QueryFullProcessImageName(hProc, 0, sb, ref size)) {
                    return sb.ToString();
                }
            } finally {
                CloseHandle(hProc);
            }
            return null;
        }

        static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new StringBuilder();
            foreach (char c in s) {
                switch (c) {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ' || c > 127) {
                            sb.AppendFormat("\\u{0:x4}", (int)c);
                        } else {
                            sb.Append(c);
                        }
                        break;
                }
            }
            return sb.ToString();
        }

        static uint GetRootPid(string procName, uint fallbackPid) {
            if (string.IsNullOrEmpty(procName)) return fallbackPid;
            try {
                string pure = procName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                    ? procName.Substring(0, procName.Length - 4)
                    : procName;
                var procs = Process.GetProcessesByName(pure);
                if (procs.Length <= 1) return fallbackPid;

                // 1. Prioriza processo mais antigo da arvore (menor StartTime = processo pai que iniciou primeiro)
                uint oldestPid = fallbackPid;
                DateTime oldestTime = DateTime.MaxValue;
                foreach (var p in procs) {
                    try {
                        if (p.StartTime < oldestTime) {
                            oldestTime = p.StartTime;
                            oldestPid = (uint)p.Id;
                        }
                    } catch {}
                }
                if (oldestPid != fallbackPid) return oldestPid;

                // 2. Fallback: processo com janela principal valida
                foreach (var p in procs) {
                    try {
                        if (p.MainWindowHandle != IntPtr.Zero && !string.IsNullOrEmpty(p.MainWindowTitle)) {
                            return (uint)p.Id;
                        }
                    } catch {}
                }
                return fallbackPid;
            } catch {
                return fallbackPid;
            }
        }

        static void Main(string[] args) {
            try {
                Console.OutputEncoding = Encoding.UTF8;
            } catch {}

            var map = new Dictionary<uint, AppAudioInfo>();
            uint excludePid = 0;
            if (args.Length > 0) {
                uint.TryParse(args[0], out excludePid);
            }

            try {
                var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
                var devices = new List<IMMDevice>();

                // 1. Tenta enumerar todos os endpoints de render ativos (DEVICE_STATE_ACTIVE = 1)
                IMMDeviceCollection coll;
                if (enumerator.EnumAudioEndpoints(0, 1, out coll) == 0 && coll != null) {
                    uint dCount;
                    if (coll.GetCount(out dCount) == 0) {
                        for (uint i = 0; i < dCount; i++) {
                            IMMDevice dev;
                            if (coll.Item(i, out dev) == 0 && dev != null) {
                                devices.Add(dev);
                            }
                        }
                    }
                }

                // Fallback: Default endpoint se a colecao estiver vazia
                if (devices.Count == 0) {
                    IMMDevice defaultDev;
                    if (enumerator.GetDefaultAudioEndpoint(0, 1, out defaultDev) == 0 && defaultDev != null) {
                        devices.Add(defaultDev);
                    }
                }

                var IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

                foreach (var dev in devices) {
                    object o;
                    if (dev.Activate(ref IID_IAudioSessionManager2, 23, IntPtr.Zero, out o) != 0 || o == null) continue;

                    var mgr = (IAudioSessionManager2)o;
                    IAudioSessionEnumerator sessionEnum;
                    if (mgr.GetSessionEnumerator(out sessionEnum) != 0 || sessionEnum == null) continue;

                    int count;
                    if (sessionEnum.GetCount(out count) != 0) continue;

                    for (int i = 0; i < count; i++) {
                        object sessionObj;
                        if (sessionEnum.GetSession(i, out sessionObj) != 0 || sessionObj == null) continue;

                        var ctl2 = sessionObj as IAudioSessionControl2;
                        if (ctl2 == null) continue;

                        uint pid = 0;
                        ctl2.GetProcessId(out pid);
                        if (pid == 0 || (excludePid > 0 && pid == excludePid)) continue;

                        // Verifica se e som do sistema
                        if (ctl2.IsSystemSoundsSession() == 0) continue;

                        int state = 0;
                        ctl2.GetState(out state);
                        if (state == 2) continue; // Expired

                        float peak = 0f;
                        var meter = sessionObj as IAudioMeterInformation;
                        if (meter != null) {
                            try { meter.GetPeakValue(out peak); } catch {}
                        }

                        if (!map.ContainsKey(pid)) {
                            string exePath = GetProcessPath((int)pid);
                            string procName = "";
                            string winTitle = "";
                            string dispName = "";

                            try {
                                var p = Process.GetProcessById((int)pid);
                                procName = p.ProcessName;
                                winTitle = p.MainWindowTitle;
                            } catch {}

                            // Ignora Hyperstream e Electron para nao mutar a si proprio
                            if (!string.IsNullOrEmpty(procName)) {
                                string pLower = procName.ToLowerInvariant();
                                if (pLower == "hyperstream" || pLower == "electron") continue;
                            }

                            if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath)) {
                                try {
                                    var vi = FileVersionInfo.GetVersionInfo(exePath);
                                    if (!string.IsNullOrEmpty(vi.FileDescription)) {
                                        dispName = vi.FileDescription.Trim();
                                    }
                                } catch {}
                            }

                            // Tenta achar titulo da janela entre processos irmaos com mesmo nome caso este subprocesso nao tenha janela direta
                            if (string.IsNullOrEmpty(winTitle) && !string.IsNullOrEmpty(procName)) {
                                try {
                                    var siblings = Process.GetProcessesByName(procName);
                                    foreach (var s in siblings) {
                                        if (!string.IsNullOrEmpty(s.MainWindowTitle)) {
                                            winTitle = s.MainWindowTitle;
                                            break;
                                        }
                                    }
                                } catch {}
                            }

                            if (string.IsNullOrEmpty(dispName)) {
                                if (!string.IsNullOrEmpty(winTitle)) {
                                    dispName = winTitle;
                                } else if (!string.IsNullOrEmpty(procName)) {
                                    dispName = procName;
                                } else {
                                    dispName = "App " + pid;
                                }
                            }

                            string cleanProcName = string.IsNullOrEmpty(procName) ? (Path.GetFileName(exePath) ?? "unknown.exe") : (procName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? procName : procName + ".exe");
                            uint rootPid = GetRootPid(cleanProcName, pid);

                            map[pid] = new AppAudioInfo {
                                pid = pid,
                                rootPid = rootPid,
                                processName = cleanProcName,
                                displayName = dispName,
                                windowTitle = winTitle ?? "",
                                exePath = exePath ?? "",
                                state = state,
                                peak = peak
                            };
                        } else {
                            if (state == 1) map[pid].state = 1;
                            if (peak > map[pid].peak) map[pid].peak = peak;
                        }
                    }
                }
            } catch (Exception ex) {
                Console.Error.WriteLine("Error in AudioSessionHelper: " + ex.Message);
            }

            var json = new StringBuilder();
            json.Append("[");
            bool first = true;
            foreach (var kvp in map) {
                var app = kvp.Value;
                if (!first) json.Append(",");
                first = false;
                json.Append("{");
                json.AppendFormat("\"pid\":{0},", app.pid);
                json.AppendFormat("\"rootPid\":{0},", app.rootPid);
                json.AppendFormat("\"processName\":\"{0}\",", EscapeJson(app.processName));
                json.AppendFormat("\"name\":\"{0}\",", EscapeJson(app.displayName));
                json.AppendFormat("\"windowTitle\":\"{0}\",", EscapeJson(app.windowTitle));
                json.AppendFormat("\"exePath\":\"{0}\",", EscapeJson(app.exePath));
                json.AppendFormat("\"state\":{0},", app.state);
                json.AppendFormat("\"peak\":{0}", app.peak.ToString(System.Globalization.CultureInfo.InvariantCulture));
                json.Append("}");
            }
            json.Append("]");
            Console.WriteLine(json.ToString());
        }
    }
}
