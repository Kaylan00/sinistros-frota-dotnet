using Microsoft.AspNetCore.Mvc;
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Models;
using SinistrosFrota.Api.Services;

namespace SinistrosFrota.Api.Controllers;

[ApiController]
[Route("api/motoristas")]
[Produces("application/json")]
public class MotoristasController(FrotaService frota) : ControllerBase
{
    /// <summary>Quadro da frota: lê a view vw_MotoristasStatusAtual.</summary>
    [HttpGet]
    public Task<List<MotoristaStatusAtual>> Listar(CancellationToken ct) => frota.ListarAsync(ct);

    [HttpGet("{id:int}")]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<MotoristaStatusAtual> Obter(int id, CancellationToken ct) => frota.ObterAsync(id, ct);

    /// <summary>Cadastra o motoboy com a moto. 409 se CPF ou placa já existem.</summary>
    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<MotoristaCriado>> Cadastrar(NovoMotoristaRequest req, CancellationToken ct)
    {
        var criado = await frota.CadastrarAsync(req, ct);
        return CreatedAtAction(nameof(Obter), new { id = criado.Id }, criado);
    }

    /// <summary>Registra o novo status do motoboy e avisa o painel pelo SignalR.</summary>
    [HttpPut("{id:int}/status")]
    public Task<MotoristaStatusAtual> AlterarStatus(int id, AlterarStatusMotoristaRequest req, CancellationToken ct) =>
        frota.AlterarStatusAsync(id, req.Status!.Value, req.Observacao, ct);
}
