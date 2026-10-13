using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Data;
using SinistrosFrota.Api.Models;

namespace SinistrosFrota.Api.Controllers;

[ApiController]
[Produces("application/json")]
public class ConsultasController(SinistrosDbContext db, TimeProvider relogio) : ControllerBase
{
    /// <summary>Apólices, com a placa coberta e se estão vigentes hoje.</summary>
    [HttpGet("api/apolices")]
    public async Task<List<ApoliceItem>> Apolices([FromQuery] int? motoristaId, CancellationToken ct)
    {
        var hoje = DateOnly.FromDateTime(relogio.GetUtcNow().UtcDateTime);
        var query = from a in db.Apolices.AsNoTracking()
                    join v in db.Veiculos on a.VeiculoId equals v.Id
                    where motoristaId == null || v.MotoristaId == motoristaId
                    orderby a.Numero
                    select new ApoliceItem(a.Id, a.Numero, a.Seguradora, v.Placa, v.MotoristaId, a.InicioVigencia, a.FimVigencia,
                        a.ValorCobertura, a.FranquiaPercentual, a.FranquiaMinima, a.InicioVigencia <= hoje && a.FimVigencia >= hoje);
        return await query.ToListAsync(ct);
    }

    /// <summary>Resumo mensal por tipo (view vw_ResumoSinistrosPorMes com GROUP BY).</summary>
    [HttpGet("api/relatorios/sinistros-por-mes")]
    public async Task<List<ResumoSinistrosMes>> SinistrosPorMes([FromQuery] int meses = 6, CancellationToken ct = default)
    {
        var agora = relogio.GetUtcNow().UtcDateTime;
        var desde = new DateOnly(agora.Year, agora.Month, 1).AddMonths(-(Math.Clamp(meses, 1, 36) - 1));
        return await db.ResumoSinistrosPorMes.AsNoTracking()
            .Where(r => r.Mes >= desde)
            .OrderBy(r => r.Mes).ThenBy(r => r.Tipo)
            .ToListAsync(ct);
    }
}
