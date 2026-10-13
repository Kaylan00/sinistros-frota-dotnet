using SinistrosFrota.Domain.Exceptions;
using SinistrosFrota.Domain.Services;

namespace SinistrosFrota.Domain.Models;

/// <summary>
/// Sinistro de um veículo da frota. O status só muda pelos métodos abaixo,
/// e todos passam por <see cref="RegrasTransicao"/>.
/// </summary>
public class Sinistro
{
    public int Id { get; private set; }
    public int ApoliceId { get; private set; }
    public int MotoristaId { get; private set; }
    public TipoSinistro Tipo { get; private set; }
    public StatusSinistro Status { get; private set; }
    public DateTime DataOcorrencia { get; private set; }
    public string Descricao { get; private set; } = "";
    public decimal ValorEstimado { get; private set; }
    public decimal? ValorIndenizado { get; private set; }
    public DateTime AbertoEm { get; private set; }
    public DateTime AtualizadoEm { get; private set; }
    public DateTime? PagoEm { get; private set; }

    private Sinistro() { } // EF Core

    public static Sinistro Abrir(Apolice apolice, int motoristaId, TipoSinistro tipo, DateTime dataOcorrencia,
        string descricao, decimal valorEstimado, DateTime agora)
    {
        if (valorEstimado <= 0)
            throw new ValorInvalidoException("O valor estimado do dano precisa ser positivo.");
        if (dataOcorrencia > agora)
            throw new ValorInvalidoException("A data da ocorrência não pode estar no futuro.");
        if (!apolice.EstaVigenteEm(dataOcorrencia))
            throw new ApoliceForaDeVigenciaException(apolice.Numero, dataOcorrencia);

        return new Sinistro
        {
            ApoliceId = apolice.Id,
            MotoristaId = motoristaId,
            Tipo = tipo,
            Status = StatusSinistro.Aberto,
            DataOcorrencia = dataOcorrencia,
            Descricao = descricao,
            ValorEstimado = valorEstimado,
            AbertoEm = agora,
            AtualizadoEm = agora
        };
    }

    public void IniciarAnalise(DateTime agora) => MudarPara(StatusSinistro.EmAnalise, agora);

    public void Aprovar(decimal valorIndenizado, DateTime agora)
    {
        RegrasTransicao.Validar(Status, StatusSinistro.Aprovado);
        if (valorIndenizado <= 0)
            throw new ValorInvalidoException("Para aprovar, o valor indenizado precisa ser positivo. Dano abaixo da franquia deve ser negado.");

        ValorIndenizado = valorIndenizado;
        MudarPara(StatusSinistro.Aprovado, agora);
    }

    public void Negar(DateTime agora) => MudarPara(StatusSinistro.Negado, agora);

    public void Pagar(DateTime agora)
    {
        if (Status == StatusSinistro.Pago)
            throw new SinistroJaPagoException(Id);

        MudarPara(StatusSinistro.Pago, agora);
        PagoEm = agora;
    }

    private void MudarPara(StatusSinistro novo, DateTime agora)
    {
        RegrasTransicao.Validar(Status, novo);
        Status = novo;
        AtualizadoEm = agora;
    }
}
