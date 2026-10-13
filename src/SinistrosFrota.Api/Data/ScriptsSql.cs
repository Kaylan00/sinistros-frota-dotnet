using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace SinistrosFrota.Api.Data;

/// <summary>
/// Roda arquivos .sql como o SSMS/sqlcmd: separa os lotes pela linha "GO"
/// e executa um por um na mesma conexão.
/// </summary>
public static partial class ScriptsSql
{
    [GeneratedRegex(@"^\s*GO\s*;?\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex SeparadorGo();

    public static string PastaPadrao => Path.Combine(AppContext.BaseDirectory, "database");

    public static IEnumerable<string> Lotes(string script) =>
        SeparadorGo().Split(script).Select(l => l.Trim()).Where(l => l.Length > 0);

    public static async Task ExecutarArquivoAsync(SqlConnection conexao, string caminho, CancellationToken ct = default)
    {
        var script = await File.ReadAllTextAsync(caminho, ct);
        foreach (var lote in Lotes(script))
        {
            await using var cmd = new SqlCommand(lote, conexao) { CommandTimeout = 120 };
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }
}
