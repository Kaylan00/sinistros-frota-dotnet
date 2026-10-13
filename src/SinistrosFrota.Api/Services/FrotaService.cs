using Microsoft.EntityFrameworkCore;
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Data;
using SinistrosFrota.Api.Hubs;
using SinistrosFrota.Api.Models;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Api.Services;

/// <summary>Quadro da frota: cadastro de motoboys e status ao vivo.</summary>
public class FrotaService(SinistrosDbContext db, NotificadorFrota notificador)
{
    public Task<List<MotoristaStatusAtual>> ListarAsync(CancellationToken ct) =>
        db.MotoristasStatusAtual.AsNoTracking().OrderBy(m => m.Nome).ToListAsync(ct);

    public async Task<MotoristaStatusAtual> ObterAsync(int motoristaId, CancellationToken ct) =>
        await db.MotoristasStatusAtual.AsNoTracking().FirstOrDefaultAsync(m => m.MotoristaId == motoristaId, ct)
        ?? throw new RecursoNaoEncontradoException("Motorista", motoristaId);

    public async Task<MotoristaCriado> CadastrarAsync(NovoMotoristaRequest req, CancellationToken ct)
    {
        // Motorista, moto e status inicial entram juntos: um SaveChanges = uma transação.
        // O EF insere o motorista primeiro e preenche o MotoristaId dos filhos com o Id gerado.
        var motorista = new Motorista
        {
            Nome = req.Nome.Trim(),
            Cpf = req.Cpf,
            Telefone = req.Telefone,
            Restaurante = req.Restaurante.Trim(),
            Veiculos = [new Veiculo { Placa = req.Placa, Modelo = req.Modelo.Trim(), Ano = req.Ano }],
            HistoricoStatus = [new RegistroStatusMotorista { Status = StatusMotorista.Disponivel, Observacao = "Cadastro" }]
        };
        db.Motoristas.Add(motorista);
        await db.SaveChangesAsync(ct);

        await notificador.StatusMotoristaAsync(await ObterAsync(motorista.Id, ct), ct);
        return new MotoristaCriado(motorista.Id, motorista.Nome, req.Placa);
    }

    public async Task<MotoristaStatusAtual> AlterarStatusAsync(int motoristaId, StatusMotorista status, string? observacao, CancellationToken ct)
    {
        if (!await db.Motoristas.AnyAsync(m => m.Id == motoristaId && m.Ativo, ct))
            throw new RecursoNaoEncontradoException("Motorista", motoristaId);

        db.StatusMotorista.Add(new RegistroStatusMotorista { MotoristaId = motoristaId, Status = status, Observacao = observacao });
        await db.SaveChangesAsync(ct);

        var atual = await ObterAsync(motoristaId, ct);
        await notificador.StatusMotoristaAsync(atual, ct);
        return atual;
    }
}
