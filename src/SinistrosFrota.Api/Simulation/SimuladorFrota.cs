using SinistrosFrota.Api.Services;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Api.Simulation;

public sealed class OpcoesSimulador
{
    public bool Ativo { get; set; }
    public int IntervaloSegundos { get; set; } = 3;
}

/// <summary>
/// Só para a demonstração: a cada poucos segundos muda o status de um motoboy,
/// como se o app dos entregadores estivesse mandando atualizações.
/// Ligado por configuração (Simulador:Ativo). Usa o mesmo FrotaService da API,
/// então cada mudança grava no banco e sai pelo SignalR.
/// </summary>
public sealed class SimuladorFrota(IServiceScopeFactory escopos, OpcoesSimulador opcoes, TimeProvider relogio, ILogger<SimuladorFrota> logger)
    : BackgroundService
{
    private readonly Random _sorteio = new();

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        logger.LogInformation("Simulador da frota ligado (a cada {Segundos}s)", opcoes.IntervaloSegundos);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, opcoes.IntervaloSegundos)));

        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                await PassoAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Passo do simulador falhou; tenta de novo no próximo ciclo");
            }
        }
    }

    private async Task PassoAsync(CancellationToken ct)
    {
        using var escopo = escopos.CreateScope();
        var frota = escopo.ServiceProvider.GetRequiredService<FrotaService>();

        var motoristas = await frota.ListarAsync(ct);
        if (motoristas.Count == 0) return;

        var agora = relogio.GetUtcNow().UtcDateTime;
        var escolhido = motoristas[_sorteio.Next(motoristas.Count)];
        var segundosNoStatus = (agora - (escolhido.StatusDesde ?? agora)).TotalSeconds;

        (StatusMotorista, string?)? proximo = escolhido.Status switch
        {
            StatusMotorista.Disponivel => _sorteio.NextDouble() < 0.75
                ? (StatusMotorista.EmEntrega, $"Pedido #{_sorteio.Next(4000, 9999)}")
                : (StatusMotorista.EmPausa, "Pausa"),
            StatusMotorista.EmEntrega when segundosNoStatus > 8 => _sorteio.NextDouble() < 0.85
                ? (StatusMotorista.Disponivel, "Entrega concluída")
                : (StatusMotorista.EmPausa, "Abastecendo"),
            StatusMotorista.EmPausa when segundosNoStatus > 15 => (StatusMotorista.Disponivel, null),
            StatusMotorista.Ocorrencia when segundosNoStatus > 90 => (StatusMotorista.Disponivel, "Liberado pela base"),
            _ => null
        };

        if (proximo is { } p)
            await frota.AlterarStatusAsync(escolhido.MotoristaId, p.Item1, p.Item2, ct);
    }
}
