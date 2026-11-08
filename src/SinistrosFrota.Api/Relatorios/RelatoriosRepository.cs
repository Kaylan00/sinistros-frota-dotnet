using Dapper;
using Microsoft.Data.SqlClient;

namespace SinistrosFrota.Api.Relatorios;

/// <summary>Connection string usada pelas consultas de leitura feitas com Dapper.</summary>
public sealed record ConexaoSql(string Valor);

/// <summary>Uma linha do resumo mensal (vw_ResumoSinistrosPorMes).</summary>
public sealed class LinhaResumoMes
{
    public DateTime Mes { get; set; }
    public string Tipo { get; set; } = "";
    public int Quantidade { get; set; }
    public int EmAndamento { get; set; }
    public int Aprovados { get; set; }
    public int Negados { get; set; }
    public decimal ValorEstimadoTotal { get; set; }
    public decimal ValorIndenizadoTotal { get; set; }
    public decimal ValorPago { get; set; }
}

/// <summary>Uma linha da fila de sinistros que ainda não terminaram (vw_SinistrosEmAberto).</summary>
public sealed class LinhaEmAberto
{
    public int SinistroId { get; set; }
    public string Status { get; set; } = "";
    public string Tipo { get; set; } = "";
    public string Motorista { get; set; } = "";
    public string Restaurante { get; set; } = "";
    public string Placa { get; set; } = "";
    public string Seguradora { get; set; } = "";
    public decimal ValorEstimado { get; set; }
    public int HorasEmAberto { get; set; }
}

/// <summary>Filtros da tela de relatórios. Nulo = sem filtro.</summary>
public sealed record FiltroRelatorio(int Meses = 6, string? Tipo = null, string? Seguradora = null, int HorasMinimas = 0);

/// <summary>
/// Consultas de leitura da tela de relatórios. A escrita continua no EF Core e nas procedures;
/// aqui é só leitura das views, então Dapper com SQL escrito à mão e sempre parametrizado.
/// </summary>
public sealed class RelatoriosRepository(ConexaoSql conexao, TimeProvider relogio)
{
    private SqlConnection Abrir() => new(conexao.Valor);

    public async Task<IReadOnlyList<LinhaResumoMes>> ResumoPorMesAsync(FiltroRelatorio filtro, CancellationToken ct = default)
    {
        var hoje = relogio.GetUtcNow().UtcDateTime;
        var desde = new DateTime(hoje.Year, hoje.Month, 1).AddMonths(-(filtro.Meses - 1));

        const string sql = """
            SELECT Mes, Tipo, Quantidade, EmAndamento, Aprovados, Negados,
                   ValorEstimadoTotal, ValorIndenizadoTotal, ValorPago
              FROM dbo.vw_ResumoSinistrosPorMes
             WHERE Mes >= @desde
               AND (@tipo IS NULL OR Tipo = @tipo)
             ORDER BY Mes DESC, Tipo;
            """;

        await using var db = Abrir();
        var linhas = await db.QueryAsync<LinhaResumoMes>(new CommandDefinition(
            sql,
            new { desde, tipo = Varchar(filtro.Tipo, 12) },
            cancellationToken: ct));
        return linhas.AsList();
    }

    public async Task<IReadOnlyList<LinhaEmAberto>> EmAbertoAsync(FiltroRelatorio filtro, CancellationToken ct = default)
    {
        const string sql = """
            SELECT SinistroId, Status, Tipo, Motorista, Restaurante, Placa, Seguradora, ValorEstimado, HorasEmAberto
              FROM dbo.vw_SinistrosEmAberto
             WHERE (@tipo IS NULL OR Tipo = @tipo)
               AND (@seguradora IS NULL OR Seguradora = @seguradora)
               AND HorasEmAberto >= @horas
             ORDER BY HorasEmAberto DESC, SinistroId;
            """;

        await using var db = Abrir();
        var linhas = await db.QueryAsync<LinhaEmAberto>(new CommandDefinition(
            sql,
            new { tipo = Varchar(filtro.Tipo, 12), seguradora = Nvarchar(filtro.Seguradora, 80), horas = filtro.HorasMinimas },
            cancellationToken: ct));
        return linhas.AsList();
    }

    public async Task<IReadOnlyList<string>> SeguradorasAsync(CancellationToken ct = default)
    {
        await using var db = Abrir();
        var nomes = await db.QueryAsync<string>(new CommandDefinition(
            "SELECT DISTINCT Seguradora FROM dbo.Apolices ORDER BY Seguradora;", cancellationToken: ct));
        return nomes.AsList();
    }

    // Mesmo tipo e tamanho da coluna (Tipo é VARCHAR(12), Seguradora é NVARCHAR(80)):
    // sem conversão implícita na comparação o índice continua sendo usado,
    // e o tamanho fixo deixa o SQL Server reaproveitar o plano de execução.
    private static DbString Varchar(string? valor, int tamanho) => Parametro(valor, tamanho, ansi: true);
    private static DbString Nvarchar(string? valor, int tamanho) => Parametro(valor, tamanho, ansi: false);

    private static DbString Parametro(string? valor, int tamanho, bool ansi) => new()
    {
        Value = string.IsNullOrWhiteSpace(valor) ? null : valor.Trim(),
        Length = tamanho,
        IsAnsi = ansi,
        IsFixedLength = false
    };
}
