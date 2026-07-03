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
- A aba `Config` tem backup JSON e sincronização manual com Supabase.

## Supabase

1. Crie um projeto no Supabase.
2. Rode o SQL de `supabase/schema.sql` no SQL Editor.
3. O app já está configurado com o projeto `maenndpjseglihhmvils` e o Sync ID `bet-tracker-main`.
4. Use `Enviar dados para Supabase` para salvar o snapshot atual.
5. Use `Carregar dados do Supabase` em outro navegador/dispositivo para recuperar o mesmo snapshot.

## Próximo passo

Depois, dá para trocar o sync manual por login com Supabase Auth e salvamento automático por usuário.
