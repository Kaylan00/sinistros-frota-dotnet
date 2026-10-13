# Estágio 1: compila e publica com o SDK
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# restore primeiro (camada em cache enquanto os .csproj não mudam)
COPY SinistrosFrota.sln ./
COPY src/SinistrosFrota.Domain/SinistrosFrota.Domain.csproj src/SinistrosFrota.Domain/
COPY src/SinistrosFrota.Api/SinistrosFrota.Api.csproj src/SinistrosFrota.Api/
RUN dotnet restore src/SinistrosFrota.Api/SinistrosFrota.Api.csproj

COPY database/ database/
COPY src/ src/
RUN dotnet publish src/SinistrosFrota.Api/SinistrosFrota.Api.csproj -c Release -o /app --no-restore

# Estágio 2: só o runtime do ASP.NET e o que foi publicado (inclui database/*.sql)
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "SinistrosFrota.Api.dll"]
