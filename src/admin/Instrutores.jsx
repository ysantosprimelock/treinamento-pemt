// Instrutores e administradores: atividade e avisos no celular
import { useState } from 'react';
import { fmtData, fmtDataHoraIso } from './comum.jsx';
import { urlApp } from './Agenda.jsx';

export default function Instrutores({ api, instrutores, recarregar, avisar }) {
  const [ocupado, setOcupado] = useState('');

  async function teste(i) {
    setOcupado(i.id);
    try {
      const r = await api.avisar({ usuarios: [i.id], titulo: 'Aviso de teste', corpo: 'Os avisos do app de treinamento estão funcionando neste celular.', url: urlApp(), tag: 'teste' });
      if (!r.aparelhos) avisar(`${i.nome} não tem celular com avisos ativos. Peça para abrir o app e tocar em "Ativar avisos".`, 'atencao');
      else avisar(`Aviso de teste enviado para ${r.enviados} de ${r.aparelhos} celular(es) de ${i.nome}.${r.removidos ? ` ${r.removidos} inscrição(ões) vencida(s) removida(s).` : ''}`, r.enviados ? 'ok' : 'atencao');
      recarregar();
    } catch (e) {
      avisar('O aviso não foi enviado: ' + e.message, 'err');
    } finally {
      setOcupado('');
    }
  }

  return (
    <section className="adm-pagina">
      <div className="adm-topo"><h1>Instrutores</h1></div>
      <div className="adm-tabela-rolagem">
        <table className="adm-tabela cartoes">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th className="num">Treinamentos</th><th>Último treinamento</th><th className="num">Agendados</th><th>Avisos no celular</th><th>Último acesso</th><th><span className="sr">Ações</span></th></tr></thead>
          <tbody>
            {instrutores.map(i => (
              <tr key={i.id} className={i.ativo ? '' : 'inativo'}>
                <td className="titulo" data-rotulo="Nome"><b>{i.nome}</b>{!i.ativo && <small>inativo</small>}</td>
                <td data-rotulo="E-mail">{i.email || '—'}</td>
                <td data-rotulo="Papel">{i.papel === 'admin' ? 'Administrador' : 'Instrutor'}</td>
                <td className="num" data-rotulo="Treinamentos">{i.treinamentos}</td>
                <td className="nowrap" data-rotulo="Último treinamento">{i.ultimo_treinamento ? fmtData(i.ultimo_treinamento) : '—'}</td>
                <td className="num" data-rotulo="Agendados">{i.agendados}</td>
                <td data-rotulo="Avisos no celular">{i.aparelhos_aviso ? <span className="situ ok">{i.aparelhos_aviso} celular{i.aparelhos_aviso > 1 ? 'es' : ''}</span> : <span className="situ esp">não ativou</span>}</td>
                <td className="nowrap" data-rotulo="Último acesso"><small>{i.ultimo_acesso ? fmtDataHoraIso(i.ultimo_acesso) : '—'}</small></td>
                <td><button type="button" className="btn peq" disabled={!i.ativo || !i.aparelhos_aviso || ocupado === i.id} onClick={() => teste(i)}>Enviar aviso de teste</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dica">Novo instrutor: crie o login no Supabase (Authentication → Users → Add user, com "Auto Confirm User") e ajuste o nome no perfil. Criar login exige a chave secreta do Supabase, que nunca fica no site.</p>
    </section>
  );
}
