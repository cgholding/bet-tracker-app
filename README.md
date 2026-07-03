# Duplo Green Tracker

App local para controlar apostas da estratégia de finalizações com Substituição+.

## Como rodar localmente

```bash
python3 -m http.server 8787
```

Depois abra:

```text
http://127.0.0.1:8787
```

## Como funciona

- Os dados ficam salvos no navegador via `localStorage`.
- A aba `Apostas` registra over, under, odds, stakes, cashout, substituição e resultado.
- Em apostas abertas, use `Cashout atual Over/Under` para monitorar quanto a Bet365 está pagando se encerrar agora.
- Ao fechar, marque o resultado como `Ganhou`, `Perdeu`, `Cashout` ou `Anulada` e preencha `Retorno/Cash` quando for cashout.
- A aba `Saldo do Dia` controla banca inicial/final e concilia o resultado do dia.
- A `Dashboard` mostra lucro fechado, dinheiro em jogo, P/L se cashar agora, ROI, reds, cashouts, duplos greens, gráfico diário e exposição por conta.

## Próximo passo

Quando for subir para Vercel, dá para manter o app estático primeiro. Depois, trocamos o armazenamento local por Supabase.
