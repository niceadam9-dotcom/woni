# Supabase Management API 토큰을 자격증명관리자에서 꺼내 %TEMP%\sbtok.txt로 복원한다.
# %TEMP%는 임시 폴더라 정리되면 토큰이 사라진다 — 그때 이 스크립트로 되살린다.
# 실행: powershell -ExecutionPolicy Bypass -File scripts\_restore-sbtok.ps1
$sig = @'
using System;
using System.Runtime.InteropServices;
public class Cred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    var bytes = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, bytes, 0, (int)c.CredentialBlobSize);
    CredFree(p);
    // blob is UTF-8 here; decoding as UTF-16 yields half-length garbage
    return System.Text.Encoding.UTF8.GetString(bytes);
  }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp
$tok = [Cred]::Read("Supabase CLI:supabase")
if (-not $tok) { Write-Host "자격증명 읽기 실패 — 'Supabase CLI:supabase' 항목 확인 필요"; exit 1 }
$tok = $tok.Trim()
$path = Join-Path $env:TEMP "sbtok.txt"
[System.IO.File]::WriteAllText($path, $tok, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "복원 완료: $path (길이 $($tok.Length), 접두 $($tok.Substring(0,[Math]::Min(4,$tok.Length))))"
