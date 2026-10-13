using System.Reflection;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using SinistrosFrota.Api.Data;
using SinistrosFrota.Api.Erros;
using SinistrosFrota.Api.Hubs;
using SinistrosFrota.Api.Services;
using SinistrosFrota.Api.Simulation;

var builder = WebApplication.CreateBuilder(args);

// Connection string: configuração/variável de ambiente; em desenvolvimento, cai para o .env do docker compose.
var connectionString = builder.Configuration.GetConnectionString("SinistrosDb")
    ?? ArquivoEnv.ConnectionStringLocal("SinistrosFrota", "SQL_PORT", "14330")
    ?? throw new InvalidOperationException("Configure ConnectionStrings:SinistrosDb ou crie o .env (cp .env.example .env).");

builder.Services.AddDbContext<SinistrosDbContext>(o => o.UseSqlServer(connectionString));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<FrotaService>();
builder.Services.AddScoped<SinistroService>();
builder.Services.AddSingleton<NotificadorFrota>();

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSignalR()
    .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<TratadorDeErros>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(o =>
{
    o.SwaggerDoc("v1", new() { Title = "Frota e Sinistros", Version = "v1", Description = "Status da frota ao vivo e fluxo de sinistros" });
    o.IncludeXmlComments(Path.Combine(AppContext.BaseDirectory, $"{Assembly.GetExecutingAssembly().GetName().Name}.xml"));
});

var simulador = builder.Configuration.GetSection("Simulador").Get<OpcoesSimulador>() ?? new OpcoesSimulador();
builder.Services.AddSingleton(simulador);
if (simulador.Ativo)
    builder.Services.AddHostedService<SimuladorFrota>();

var app = builder.Build();

if (builder.Configuration.GetValue("Banco:Inicializar", true))
{
    await BancoInicializador.ExecutarAsync(connectionString, builder.Configuration.GetValue("Banco:Seed", true), app.Logger);
}

app.UseExceptionHandler();
app.UseStatusCodePages();

app.UseSwagger();
app.UseSwaggerUI();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();
app.MapHub<FrotaHub>(FrotaHub.Rota);
app.MapGet("/health", async (SinistrosDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct)
        ? Results.Ok(new { status = "ok", banco = "ok" })
        : Results.Json(new { status = "erro", banco = "indisponivel" }, statusCode: 503))
    .ExcludeFromDescription();

app.Run();

/// <summary>Exposto para o WebApplicationFactory dos testes de integração.</summary>
public partial class Program;
