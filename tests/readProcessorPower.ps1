# Read-only cross-check of Windows' reported CPU frequency and thermal limit.
# ProcessorInformation (11) is a query with a NULL input buffer, never a policy write.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExtaplanProcessorPowerRead {
    [StructLayout(LayoutKind.Sequential)]
    public struct Info {
        public uint Number, MaxMhz, CurrentMhz, MhzLimit, MaxIdleState, CurrentIdleState;
    }
    [DllImport("powrprof.dll")]
    private static extern uint CallNtPowerInformation(int level, IntPtr input, uint inputLength, IntPtr output, uint outputLength);
    public static Info[] Read() {
        int count = Environment.ProcessorCount, size = Marshal.SizeOf(typeof(Info));
        IntPtr memory = Marshal.AllocHGlobal(count * size);
        try {
            uint status = CallNtPowerInformation(11, IntPtr.Zero, 0, memory, (uint)(count * size));
            if (status != 0) throw new Exception("ProcessorInformation query failed: 0x" + status.ToString("X"));
            Info[] result = new Info[count];
            for (int i = 0; i < count; i++) result[i] = (Info)Marshal.PtrToStructure(IntPtr.Add(memory, i * size), typeof(Info));
            return result;
        } finally { Marshal.FreeHGlobal(memory); }
    }
}
'@
$result = [pscustomobject]@{Utc=[DateTime]::UtcNow.ToString('o'); Processors=@([ExtaplanProcessorPowerRead]::Read())}
if ($args.Count -gt 0) { $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $args[0] }
$result | ConvertTo-Json -Depth 4
