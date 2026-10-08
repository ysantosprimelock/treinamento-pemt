// Correção da prova (funções puras). As questões e o gabarito NÃO ficam no código do app:
// vêm do banco (tabela public.provas) e ficam guardados no aparelho — ver prova/index.js.
// Formato: { id, titulo, notaMinima (0..1), questoes: [{ p, a: [4 alternativas], c (índice da correta) }] }

export const LETRAS = ['A', 'B', 'C', 'D'];

// Mínimo de acertos para aprovar (70% de 10 = 7)
export const minimoAcertos = prova => Math.ceil(prova.questoes.length * prova.notaMinima - 1e-9);

// respostas: array com o índice marcado (0..3) em cada questão
export function corrigir(prova, respostas) {
  const total = prova.questoes.length;
  if (!Array.isArray(respostas) || respostas.length !== total) throw new Error('Respostas incompletas.');
  let acertos = 0;
  prova.questoes.forEach((q, i) => {
    const r = respostas[i];
    if (!Number.isInteger(r) || r < 0 || r >= q.a.length) throw new Error(`Questão ${i + 1} sem resposta.`);
    if (r === q.c) acertos++;
  });
  return { acertos, total, aprovado: acertos >= minimoAcertos(prova) };
}

// Resultado final de um operador: a decisão do instrutor (se houver) vale sobre a nota da prova.
// prova: tentativa (qr ou papel) ou undefined; decisao: { aprovado, em } ou undefined
export function resultadoFinal(prova, decisao) {
  if (decisao && typeof decisao.aprovado === 'boolean') return decisao.aprovado;
  if (prova && typeof prova.aprovado === 'boolean') return prova.aprovado;
  return null; // sem resultado ainda
}
