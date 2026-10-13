using System.Data;
using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Data;
using SinistrosFrota.Api.Hubs;
using SinistrosFrota.Domain.Exceptions;
using SinistrosFrota.Domain.Models;
using SinistrosFrota.Domain.Services;

namespace SinistrosFrota.Api.Services;

/// <summary>
/// Fluxo do sinistro. Duas camadas de regra:
///  1) o domínio em C# valida antes (erro rápido, regra testada com xUnit);
///  2) a procedure valida de novo dentro da transação, com lock (é ela que decide
///     quando duas requisições disputam o mesmo sinistro).
/// Leitura vai pelo EF; escrita de status vai pelas procedures.
/// </summary>
public class SinistroService(SinistrosDbContext db, NotificadorFrota notificador, FrotaService frota, TimeProvider relogio)
{
    private static readonly NumberFormatInfo Brasil = new() { NumberDecimalSeparator = ",", NumberGroupSeparator = "." };

    private DateTime Agora => relogio.GetUtcNow().UtcDateTime;

    public async Task<List<SinistroItem>> ListarAsync(StatusSinistro? status, int? motoristaId, int pagina, int tamanho, CancellationToken ct)
    {
        var query = Consulta();
        if (status is not null) query = query.Where(s => s.Status == status);
        if (motoristaId is not null) query = query.Where(s => s.MotoristaId == motoristaId);

        var linhas = await query
            .OrderByDescending(s => s.AbertoEm).ThenByDescending(s => s.Id)
            .Skip((pagina - 1) * tamanho).Take(tamanho)
            .ToListAsync(ct);
        return linhas.Select(ParaItem).ToList();
    }

    public async Task<SinistroDetalhe> ObterAsync(int id, CancellationToken ct)
    {
        var linha = await Consulta().FirstOrDefaultAsync(s => s.Id == id, ct)
                    ?? throw new RecursoNaoEncontradoException("Sinistro", id);

        var historico = await db.SinistroHistorico.AsNoTracking()
            .Where(h => h.SinistroId == id)
            .OrderBy(h => h.AlteradoEm).ThenBy(h => h.Id)
            .Select(h => new HistoricoItem(h.StatusAnterior, h.StatusNovo, h.Observacao, h.Usuario, h.AlteradoEm))
            .ToListAsync(ct);

        return new SinistroDetalhe(ParaItem(linha), linha.Descricao, linha.Seguradora, historico);
    }

    public async Task<SinistroDetalhe> AbrirAsync(AbrirSinistroRequest req, string usuario, CancellationToken ct)
    {
        var apolice = await EncontrarApoliceAsync(req.MotoristaId, req.ApoliceId, ct);
        var dataOcorrencia = req.DataOcorrencia!.Value.UtcDateTime;

        // Regra no C#: vigência, valor positivo, data no passado (lança exceção de domínio)
        Sinistro.Abrir(apolice, req.MotoristaId, req.Tipo!.Value, dataOcorrencia, req.Descricao, req.ValorEstimado, Agora);

        // Gravação pela procedure (parâmetro OUTPUT devolve o Id criado)
        var idCriado = new SqlParameter("@SinistroId", SqlDbType.Int) { Direction = ParameterDirection.Output };
        await db.Database.ExecuteSqlRawAsync(
            "EXEC dbo.sp_AbrirSinistro @ApoliceId, @MotoristaId, @Tipo, @DataOcorrencia, @Descricao, @ValorEstimado, @Usuario, @SinistroId OUTPUT",
            [
                new SqlParameter("@ApoliceId", apolice.Id),
                new SqlParameter("@MotoristaId", req.MotoristaId),
                new SqlParameter("@Tipo", SqlDbType.VarChar, 12) { Value = req.Tipo.Value.ToString() },
                new SqlParameter("@DataOcorrencia", SqlDbType.DateTime2) { Value = dataOcorrencia },
                new SqlParameter("@Descricao", SqlDbType.NVarChar, 500) { Value = req.Descricao.Trim() },
                new SqlParameter("@ValorEstimado", SqlDbType.Decimal) { Precision = 12, Scale = 2, Value = req.ValorEstimado },
                new SqlParameter("@Usuario", SqlDbType.NVarChar, 60) { Value = usuario },
                idCriado
            ],
            ct);

        var detalhe = await ObterAsync((int)idCriado.Value, ct);
        await notificador.SinistroAsync("Aberto", detalhe.Sinistro, ct);
        // a procedure também colocou o motoboy em "Ocorrencia": avisa o quadro da frota
        await notificador.StatusMotoristaAsync(await frota.ObterAsync(req.MotoristaId, ct), ct);
        return detalhe;
    }

    public async Task<SinistroDetalhe> AlterarStatusAsync(int id, AlterarStatusSinistroRequest req, string usuario, CancellationToken ct)
    {
        var novo = req.NovoStatus!.Value;
        if (novo == StatusSinistro.Pago)
            return await PagarAsync(id, req.Observacao, usuario, ct);

        var sinistro = await CarregarAsync(id, ct);
        decimal? valorIndenizado = null;

        switch (novo)
        {
            case StatusSinistro.EmAnalise:
                sinistro.IniciarAnalise(Agora);
                break;
            case StatusSinistro.Negado:
                sinistro.Negar(Agora);
                break;
            case StatusSinistro.Aprovado:
                RegrasTransicao.Validar(sinistro.Status, novo);
                var apolice = await db.Apolices.AsNoTracking().FirstAsync(a => a.Id == sinistro.ApoliceId, ct);
                var calculo = CalculadoraIndenizacao.Calcular(apolice, sinistro.Tipo, req.ValorApurado ?? sinistro.ValorEstimado);
                if (!calculo.TemIndenizacao)
                    throw new ValorInvalidoException(
                        $"O dano (R$ {calculo.ValorBase.ToString("N2", Brasil)}) não passa da franquia (R$ {calculo.Franquia.ToString("N2", Brasil)}). Negue o sinistro.");
                sinistro.Aprovar(calculo.ValorIndenizado, Agora);
                valorIndenizado = calculo.ValorIndenizado;
                break;
            default:
                RegrasTransicao.Validar(sinistro.Status, novo); // Aberto nunca é destino: lança 409
                break;
        }

        // ExecuteSqlAsync com string interpolada: cada {valor} vira um parâmetro (@p0, @p1...),
        // nunca texto concatenado. Isso é o que impede SQL injection.
        var status = novo.ToString();
        await db.Database.ExecuteSqlAsync(
            $"EXEC dbo.sp_AlterarStatusSinistro @SinistroId = {id}, @NovoStatus = {status}, @Usuario = {usuario}, @Observacao = {req.Observacao}, @ValorIndenizado = {valorIndenizado}",
            ct);

        return await NotificarAsync(id, "StatusAlterado", ct);
    }

    public async Task<SinistroDetalhe> PagarAsync(int id, string? observacao, string usuario, CancellationToken ct)
    {
        var sinistro = await CarregarAsync(id, ct);
        sinistro.Pagar(Agora); // já pago -> SinistroJaPagoException; não aprovado -> TransicaoInvalidaException

        await db.Database.ExecuteSqlAsync(
            $"EXEC dbo.sp_PagarSinistro @SinistroId = {id}, @Usuario = {usuario}, @Observacao = {observacao}",
            ct);

        return await NotificarAsync(id, "Pago", ct);
    }

    private async Task<SinistroDetalhe> NotificarAsync(int id, string evento, CancellationToken ct)
    {
        var detalhe = await ObterAsync(id, ct);
        await notificador.SinistroAsync(evento, detalhe.Sinistro, ct);
        return detalhe;
    }

    private async Task<Sinistro> CarregarAsync(int id, CancellationToken ct) =>
        await db.Sinistros.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct)
        ?? throw new RecursoNaoEncontradoException("Sinistro", id);

    private async Task<Apolice> EncontrarApoliceAsync(int motoristaId, int? apoliceId, CancellationToken ct)
    {
        if (!await db.Motoristas.AnyAsync(m => m.Id == motoristaId && m.Ativo, ct))
            throw new RecursoNaoEncontradoException("Motorista", motoristaId);

        var query = from a in db.Apolices.AsNoTracking()
                    join v in db.Veiculos on a.VeiculoId equals v.Id
                    where v.MotoristaId == motoristaId
                    select a;

        if (apoliceId is not null)
            return await db.Apolices.AsNoTracking().FirstOrDefaultAsync(a => a.Id == apoliceId, ct)
                   ?? throw new RecursoNaoEncontradoException("Apólice", apoliceId);

        return await query.OrderByDescending(a => a.FimVigencia).FirstOrDefaultAsync(ct)
               ?? throw new RecursoNaoEncontradoException("Apólice do motorista", motoristaId);
    }

    private IQueryable<Linha> Consulta() =>
        from s in db.Sinistros.AsNoTracking()
        join m in db.Motoristas on s.MotoristaId equals m.Id
        join a in db.Apolices on s.ApoliceId equals a.Id
        join v in db.Veiculos on a.VeiculoId equals v.Id
        select new Linha
        {
            Id = s.Id, Status = s.Status, Tipo = s.Tipo, MotoristaId = m.Id, Motorista = m.Nome,
            Restaurante = m.Restaurante, Placa = v.Placa, NumeroApolice = a.Numero, Seguradora = a.Seguradora,
            ValorEstimado = s.ValorEstimado, ValorIndenizado = s.ValorIndenizado, DataOcorrencia = s.DataOcorrencia,
            AbertoEm = s.AbertoEm, AtualizadoEm = s.AtualizadoEm, PagoEm = s.PagoEm, Descricao = s.Descricao
        };

    private static SinistroItem ParaItem(Linha l) => new(
        l.Id, l.Status, l.Tipo, l.MotoristaId, l.Motorista, l.Restaurante, l.Placa, l.NumeroApolice,
        l.ValorEstimado, l.ValorIndenizado, l.DataOcorrencia, l.AbertoEm, l.AtualizadoEm, l.PagoEm,
        RegrasTransicao.Proximos(l.Status));

    private sealed class Linha
    {
        public int Id { get; init; }
        public StatusSinistro Status { get; init; }
        public TipoSinistro Tipo { get; init; }
        public int MotoristaId { get; init; }
        public string Motorista { get; init; } = "";
        public string Restaurante { get; init; } = "";
        public string Placa { get; init; } = "";
        public string NumeroApolice { get; init; } = "";
        public string Seguradora { get; init; } = "";
        public decimal ValorEstimado { get; init; }
        public decimal? ValorIndenizado { get; init; }
        public DateTime DataOcorrencia { get; init; }
        public DateTime AbertoEm { get; init; }
        public DateTime AtualizadoEm { get; init; }
        public DateTime? PagoEm { get; init; }
        public string Descricao { get; init; } = "";
    }
}
