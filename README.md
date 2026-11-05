# Grade Horária – EMEF Oliveira Viana

Sistema web para **elaborar automaticamente a grade horária escolar**, considerando turmas, períodos,
professores, disciplinas, cargas horárias, H.A., CCH, HL, disponibilidades e restrições individuais.

A montagem usa **otimização combinatória real** (Google OR-Tools **CP-SAT**), e não distribuição aleatória:
todas as restrições obrigatórias são garantidas matematicamente e as preferências são otimizadas
conforme a prioridade escolhida. Quando não existe solução, o sistema **não apresenta uma grade
aparentemente válida**: ele mostra quais restrições, juntas, impedem a montagem e quais aulas não cabem.

---

## Como usar (sem conhecimentos de programação)

1. Instale o **Python 3.10 ou mais novo** — <https://www.python.org/downloads/>
   (no Windows, marque **"Add Python to PATH"** na instalação).
2. Baixe esta pasta (botão **Code → Download ZIP** no GitHub) e descompacte.
3. Dê dois cliques em:
   - **Windows:** `iniciar.bat`
   - **Linux/macOS:** `iniciar.sh`
4. Na primeira vez, o programa instala seus componentes (alguns minutos, precisa de internet).
   Depois, o navegador abre em <http://127.0.0.1:8000>.
5. **Não feche** a janela preta enquanto estiver usando o sistema.

> Os dados ficam salvos **somente no navegador deste computador** (IndexedDB), com salvamento
> automático. Use **Configurações e backups → Baixar backup completo** regularmente.
> Nenhum dado é enviado para a internet. O sistema não coleta nomes de estudantes.

Quer só conhecer? Em **Configurações e backups → Outras opções → Carregar demonstração** há uma
escola **fictícia** completa. Seus dados reais ficam guardados e voltam com "Voltar aos dados reais".

## Roteiro de uso

| Passo | Tela | O que fazer |
|---|---|---|
| 1 | Configuração da escola | Dias letivos, duração da aula, **como a jornada é contabilizada** (unidade e peso de cada componente) |
| 2 | Cadastro de períodos | Aulas por dia, **horários reais** de cada aula e intervalos (individuais por período) |
| 3 | Cadastro de turmas | Já vem com a estrutura informada (15 manhã + 15 tarde); informe as turmas pendentes de 2º e 3º anos da tarde |
| 4 | Matriz curricular | Disciplinas, professor e aulas semanais de cada turma |
| 5 | Cadastro de professores | Período de trabalho (obrigatório), disciplinas e atribuição de aulas (integrada à matriz) |
| 6 | Cargas horárias | Carga total, aulas, H.A., CCH, HL e outras; demonstrativo com divergências |
| 7 | H.A., CCH e HL | Quantidade, dias/horários possíveis, início/meio/fim, fixo ou flexível, turma relacionada |
| 8 | Disponibilidade | Restrições obrigatórias (indisponível, entrada/saída, limites) e preferências |
| 9 | Montagem automática | Verificação dos dados, escolha das prioridades e geração de várias grades para comparar |
| 10 | Grades por turma/professor/geral | Visualização e **edição manual** (arrastar, trocar, bloquear, desfazer/refazer) |
| 11 | Relatórios | PDF, Excel, CSV e impressão |

Nada é presumido: horários reais das aulas, quantidade de turmas pendentes, disciplinas, professores
e regras de H.A./CCH/HL começam em branco e são definidos pela escola.

## Motor de montagem (o que é garantido)

Restrições **obrigatórias** (nunca violadas):

1. Professor em no máximo um lugar por horário — inclusive entre períodos cujos horários reais se sobreponham.
2. Turma com no máximo uma aula/atividade por horário.
3. Todas as aulas cadastradas na matriz são alocadas (nem mais, nem menos).
4. H.A., CCH, HL e outras atividades na quantidade cadastrada, respeitando dias, horários,
   modo fixo/flexível, máximo por dia e posição (início/fim do período, início/fim da jornada, meio).
5. Indisponibilidades, dias de trabalho, horário de entrada/saída, períodos do professor.
6. Limites de aulas diárias e consecutivas (quando marcados como obrigatórios).
7. Turma só recebe aulas no seu período, respeitando horários bloqueados e limite diário.
8. Turmas com menos aulas que horários (ex.: 27 e 24) ficam com os horários restantes **livres**.
9. Aulas bloqueadas manualmente são mantidas em novas otimizações.

**Otimização** (pesos conforme a prioridade): janelas dos professores, dias e turnos de comparecimento,
aulas isoladas, distribuição das disciplinas na semana, 3 aulas seguidas da mesma disciplina,
horários livres das turmas no início/fim do dia, aulas geminadas e preferências individuais.

Prioridades disponíveis: menos janelas, menos dias trabalhados, melhor distribuição das disciplinas,
melhor aproveitamento dos horários, maior atendimento às preferências e solução equilibrada.
A pontuação (0–100) serve para **comparar** grades e vem acompanhada da lista de preferências
atendidas e não atendidas — não é garantia absoluta de qualidade.

**Diagnóstico de inviabilidade**: verificações prévias (erros de cadastro e incompatibilidades
matemáticas), núcleo de conflito (conjunto mínimo de restrições que juntas impedem a grade),
menor flexibilização que tornaria a grade possível e lista de aulas que não cabem.

## Arquitetura

```
backend/   Python + FastAPI + OR-Tools CP-SAT (motor de otimização; serve também a interface)
  app/solver.py     modelo CP-SAT, estratégias e diagnóstico
  app/precheck.py   verificações prévias
  app/main.py       API (/api/solve, /api/jobs/{id}, /api/health)
  tests/            testes automatizados + validador independente
frontend/  React + TypeScript (interface; dados no IndexedDB do navegador)
  dist/             versão compilada (já incluída: não é preciso Node.js para usar)
e2e/       teste de ponta a ponta no navegador (Playwright)
```

## Testes

```bash
cd frontend && npm install && npm test          # 19 testes da lógica (conflitos, métricas, importação, relatórios…)
cd backend && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q   # motor + API
node e2e/e2e.cjs http://127.0.0.1:8000/          # com o servidor rodando
```

Os testes do motor usam dados **fictícios** e um **validador independente** (que não usa o código do
solver) para conferir matematicamente que não há sobreposições nem violações. Cobrem professores só
de manhã, só à tarde e nos dois períodos; indisponibilidades; H.A., CCH e HL em todas as posições;
turmas de 40, 30, 27 e 24 aulas; professores com várias turmas; aulas bloqueadas; sobreposição de
horários entre períodos; uma escola fictícia completa com 30 turmas; e situações sem solução possível.

## Desenvolvimento

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev       # http://localhost:5173 (usa o backend na porta 8000)
npm run build                                   # atualiza frontend/dist
```
