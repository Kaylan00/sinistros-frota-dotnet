using SinistrosFrota.Domain.Exceptions;

namespace SinistrosFrota.Domain.Models;

/// <summary>Apólice de seguro de um veículo da frota.</summary>
public class Apolice
{
    public int Id { get; private set; }
    public int VeiculoId { get; private set; }
    public string Numero { get; private set; } = "";
    public string Seguradora { get; private set; } = "";
    public DateOnly InicioVigencia { get; private set; }
    public DateOnly FimVigencia { get; private set; }

    /// <summary>Teto que a seguradora paga por sinistro.</summary>
    public decimal ValorCobertura { get; private set; }

    /// <summary>Percentual do dano que fica com o segurado (0 a 100).</summary>
    public decimal FranquiaPercentual { get; private set; }

    /// <summary>Franquia nunca é menor que este valor.</summary>
    public decimal FranquiaMinima { get; private set; }

    private Apolice() { } // EF Core

    public Apolice(int id, int veiculoId, string numero, string seguradora, DateOnly inicioVigencia, DateOnly fimVigencia,
        decimal valorCobertura, decimal franquiaPercentual, decimal franquiaMinima)
    {
        if (fimVigencia < inicioVigencia)
            throw new ValorInvalidoException("O fim da vigência não pode ser antes do início.");
        if (valorCobertura <= 0)
            throw new ValorInvalidoException("O valor de cobertura precisa ser positivo.");
        if (franquiaPercentual is < 0 or > 100)
            throw new ValorInvalidoException("O percentual de franquia vai de 0 a 100.");
        if (franquiaMinima < 0)
            throw new ValorInvalidoException("A franquia mínima não pode ser negativa.");

        Id = id;
        VeiculoId = veiculoId;
        Numero = numero;
        Seguradora = seguradora;
        InicioVigencia = inicioVigencia;
        FimVigencia = fimVigencia;
        ValorCobertura = valorCobertura;
        FranquiaPercentual = franquiaPercentual;
        FranquiaMinima = franquiaMinima;
    }

    /// <summary>Vigência por dia inteiro: o último dia vale até 23:59:59.</summary>
    public bool EstaVigenteEm(DateTime momento)
    {
        var dia = DateOnly.FromDateTime(momento);
        return dia >= InicioVigencia && dia <= FimVigencia;
    }
}
