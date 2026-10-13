namespace SinistrosFrota.Api.Data;

/// <summary>
/// Lê o .env da raiz do repositório (o mesmo que o docker compose usa) para montar
/// a connection string local sem precisar repetir a senha em appsettings.
/// Variável de ambiente de verdade sempre ganha do arquivo.
/// </summary>
public static class ArquivoEnv
{
    public static IReadOnlyDictionary<string, string> Ler(string? pastaInicial = null)
    {
        var valores = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var pasta = new DirectoryInfo(pastaInicial ?? Directory.GetCurrentDirectory());

        while (pasta is not null && !File.Exists(Path.Combine(pasta.FullName, ".env")))
            pasta = pasta.Parent;

        if (pasta is null) return valores;

        foreach (var linha in File.ReadAllLines(Path.Combine(pasta.FullName, ".env")))
        {
            var texto = linha.Trim();
            if (texto.Length == 0 || texto.StartsWith('#')) continue;
            var igual = texto.IndexOf('=');
            if (igual <= 0) continue;
            valores[texto[..igual].Trim()] = texto[(igual + 1)..].Trim().Trim('"');
        }
        return valores;
    }

    public static string Valor(string chave, string padrao, IReadOnlyDictionary<string, string> env) =>
        Environment.GetEnvironmentVariable(chave) ?? (env.TryGetValue(chave, out var v) ? v : padrao);

    /// <summary>Connection string para o SQL Server do docker compose rodando na máquina.</summary>
    public static string? ConnectionStringLocal(string banco, string chavePorta, string portaPadrao)
    {
        var env = Ler();
        var senha = Valor("MSSQL_SA_PASSWORD", "", env);
        if (senha.Length == 0) return null;
        var porta = Valor(chavePorta, portaPadrao, env);
        return $"Server=localhost,{porta};Database={banco};User Id=sa;Password={senha};TrustServerCertificate=True";
    }
}
