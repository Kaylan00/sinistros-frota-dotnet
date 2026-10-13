using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Data;
using SinistrosFrota.Api.Models;
using SinistrosFrota.Api.Services;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Api.Controllers;

[ApiController]
[Route("api/sinistros")]
[Produces("application/json")]
public class SinistrosController(SinistroService sinistros, SinistrosDbContext db) : ControllerBase
{
    /// <summary>Lista sinistros (mais recentes primeiro), com filtro opcional.</summary>
    [HttpGet]
    public Task<List<SinistroItem>> Listar([FromQuery] StatusSinistro? status, [FromQuery] int? motoristaId,
        [FromQuery] int pagina = 1, [FromQuery] int tamanho = 50, CancellationToken ct = default) =>
        sinistros.ListarAsync(status, motoristaId, Math.Max(1, pagina), Math.Clamp(tamanho, 1, 200), ct);

    /// <summary>Fila de trabalho: lê a view vw_SinistrosEmAberto.</summary>
    [HttpGet("em-aberto")]
    public Task<List<SinistroEmAberto>> EmAberto(CancellationToken ct) =>
        db.SinistrosEmAberto.AsNoTracking().OrderBy(s => s.AbertoEm).ToListAsync(ct);

    /// <summary>Detalhe com o histórico de status.</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<SinistroDetalhe> Obter(int id, CancellationToken ct) => sinistros.ObterAsync(id, ct);

    /// <summary>Abre um sinistro (sp_AbrirSinistro). 422 se a apólice não estava vigente.</summary>
    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<SinistroDetalhe>> Abrir(AbrirSinistroRequest req, CancellationToken ct)
    {
        var criado = await sinistros.AbrirAsync(req, Usuario.De(Request), ct);
        return CreatedAtAction(nameof(Obter), new { id = criado.Sinistro.Id }, criado);
    }

    /// <summary>Muda o status (sp_AlterarStatusSinistro). 409 se a transição não é permitida.</summary>
    [HttpPost("{id:int}/transicoes")]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public Task<SinistroDetalhe> AlterarStatus(int id, AlterarStatusSinistroRequest req, CancellationToken ct) =>
        sinistros.AlterarStatusAsync(id, req, Usuario.De(Request), ct);

    /// <summary>Paga a indenização (sp_PagarSinistro). 409 se já foi pago ou não está aprovado.</summary>
    [HttpPost("{id:int}/pagamento")]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<SinistroDetalhe> Pagar(int id, PagarSinistroRequest? req, CancellationToken ct) =>
        sinistros.PagarAsync(id, req?.Observacao, Usuario.De(Request), ct);
}
