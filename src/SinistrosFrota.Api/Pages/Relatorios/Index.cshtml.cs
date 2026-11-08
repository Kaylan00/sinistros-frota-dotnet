using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using SinistrosFrota.Api.Relatorios;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Api.Pages.Relatorios;

/// <summary>Tela de relatórios para a operação: resumo mensal e fila de sinistros em aberto.</summary>
public class IndexModel(RelatoriosRepository relatorios) : PageModel
{
    public static readonly string[] Tipos = Enum.GetNames<TipoSinistro>();

    [BindProperty(SupportsGet = true)]
    [Range(1, 24, ErrorMessage = "O período vai de 1 a 24 meses.")]
    public int Meses { get; set; } = 6;

    [BindProperty(SupportsGet = true)]
    public string? Tipo { get; set; }

    [BindProperty(SupportsGet = true)]
    [StringLength(80)]
    public string? Seguradora { get; set; }

    [BindProperty(SupportsGet = true)]
    [Range(0, 8760, ErrorMessage = "As horas em aberto vão de 0 a 8760.")]
    public int HorasMinimas { get; set; }

    public IReadOnlyList<LinhaResumoMes> Resumo { get; private set; } = [];
    public IReadOnlyList<LinhaEmAberto> EmAberto { get; private set; } = [];
    public IReadOnlyList<string> Seguradoras { get; private set; } = [];

    public async Task OnGetAsync(CancellationToken ct)
    {
        Seguradoras = await relatorios.SeguradorasAsync(ct);
        if (!FiltroValido()) return;

        var filtro = Filtro();
        Resumo = await relatorios.ResumoPorMesAsync(filtro, ct);
        EmAberto = await relatorios.EmAbertoAsync(filtro, ct);
    }

    /// <summary>GET /relatorios?handler=Csv: a fila em aberto em CSV (separador ; para abrir direto no Excel).</summary>
    public async Task<IActionResult> OnGetCsvAsync(CancellationToken ct)
    {
        if (!FiltroValido()) return BadRequest(ModelState);

        var linhas = await relatorios.EmAbertoAsync(Filtro(), ct);
        var csv = new StringBuilder("Sinistro;Status;Tipo;Motoboy;Restaurante;Placa;Seguradora;ValorEstimado;HorasEmAberto\n");
        foreach (var l in linhas)
        {
            csv.AppendJoin(';', l.SinistroId, l.Status, l.Tipo, Campo(l.Motorista), Campo(l.Restaurante), l.Placa,
                Campo(l.Seguradora), l.ValorEstimado.ToString("0.00", CultureInfo.InvariantCulture), l.HorasEmAberto);
            csv.Append('\n');
        }

        // BOM para o Excel reconhecer os acentos
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray();
        return File(bytes, "text/csv; charset=utf-8", "sinistros-em-aberto.csv");
    }

    private bool FiltroValido()
    {
        if (!string.IsNullOrEmpty(Tipo) && !Tipos.Contains(Tipo))
            ModelState.AddModelError(nameof(Tipo), "Tipo de sinistro desconhecido.");
        return ModelState.IsValid;
    }

    private FiltroRelatorio Filtro() => new(Meses, Tipo, Seguradora, HorasMinimas);

    /// <summary>Aspas quando o texto tem ; ou aspas, e início de fórmula do Excel neutralizado.</summary>
    internal static string Campo(string valor)
    {
        if (valor.Length > 0 && "=+-@".Contains(valor[0])) valor = "'" + valor;
        return valor.IndexOfAny([';', '"', '\n']) >= 0 ? "\"" + valor.Replace("\"", "\"\"") + "\"" : valor;
    }

    public static string NomeTipo(string tipo) => tipo switch
    {
        nameof(TipoSinistro.Acidente) => "Acidente",
        nameof(TipoSinistro.Roubo) => "Roubo",
        nameof(TipoSinistro.AvariaMoto) => "Avaria na moto",
        nameof(TipoSinistro.AvariaBau) => "Avaria no baú",
        _ => tipo
    };

    public static string NomeStatus(string status) => status switch
    {
        nameof(StatusSinistro.EmAnalise) => "Em análise",
        _ => status
    };
}
