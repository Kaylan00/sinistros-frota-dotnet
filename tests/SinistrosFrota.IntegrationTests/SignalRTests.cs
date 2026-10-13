using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection; // AddJsonProtocol
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Hubs;
using SinistrosFrota.Api.Models;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.IntegrationTests;

[Collection(ApiCollection.Nome)]
public class SignalRTests(ApiFixture api)
{
    private HubConnection NovaConexao() =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(api.Factory.Server.BaseAddress, FrotaHub.Rota), o =>
            {
                // o TestServer não tem rede de verdade: o cliente usa o handler em memória
                o.HttpMessageHandlerFactory = _ => api.Factory.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
            })
            .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()))
            .Build();

    [Fact]
    public async Task Mudanca_de_status_do_motorista_chega_ao_vivo()
    {
        var recebido = new TaskCompletionSource<MotoristaStatusAtual>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var conexao = NovaConexao();
        conexao.On<MotoristaStatusAtual>(FrotaHub.EventoStatusMotorista, m =>
        {
            if (m.MotoristaId == 2) recebido.TrySetResult(m);
        });
        await conexao.StartAsync();

        var resp = await api.Client.PutAsJsonAsync("/api/motoristas/2/status", new { status = "EmPausa", observacao = "Almoço" });
        resp.EnsureSuccessStatusCode();

        var evento = await recebido.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(StatusMotorista.EmPausa, evento.Status);
        Assert.Equal("Almoço", evento.Observacao);
    }

    [Fact]
    public async Task Abertura_de_sinistro_chega_ao_vivo()
    {
        var recebido = new TaskCompletionSource<SinistroEvento>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var conexao = NovaConexao();
        conexao.On<SinistroEvento>(FrotaHub.EventoSinistro, e => recebido.TrySetResult(e));
        await conexao.StartAsync();

        var criado = await api.AbrirSinistroAsync(motoristaId: 3, valor: 900m, tipo: TipoSinistro.AvariaMoto);

        var evento = await recebido.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("Aberto", evento.Evento);
        Assert.Equal(criado.Sinistro.Id, evento.Sinistro.Id);
    }
}
