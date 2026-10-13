using Microsoft.AspNetCore.SignalR;
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Models;

namespace SinistrosFrota.Api.Hubs;

/// <summary>
/// Canal ao vivo da central (/hubs/frota). O servidor só empurra eventos;
/// quem quer mudar algo usa a API REST, que valida e depois avisa todo mundo por aqui.
/// </summary>
public class FrotaHub : Hub
{
    public const string Rota = "/hubs/frota";
    public const string EventoStatusMotorista = "StatusMotoristaAlterado";
    public const string EventoSinistro = "SinistroAtualizado";
}

/// <summary>Envolve o IHubContext para os services não dependerem do SignalR diretamente.</summary>
public class NotificadorFrota(IHubContext<FrotaHub> hub)
{
    public Task StatusMotoristaAsync(MotoristaStatusAtual motorista, CancellationToken ct = default) =>
        hub.Clients.All.SendAsync(FrotaHub.EventoStatusMotorista, motorista, ct);

    public Task SinistroAsync(string evento, SinistroItem sinistro, CancellationToken ct = default) =>
        hub.Clients.All.SendAsync(FrotaHub.EventoSinistro, new SinistroEvento(evento, sinistro), ct);
}
