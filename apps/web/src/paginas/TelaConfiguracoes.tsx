import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageCircle, PanelRight, UserRound } from "lucide-react";
import { useAutenticacao } from "../contexto/ContextoAutenticacao";
import { clienteApi, ErroApi } from "../lib/api";
import { Botao } from "../componentes/ui/Botao";
import { Campo } from "../componentes/ui/Campo";
import { useContextoLayout } from "../layout/useContextoLayout";
import type { PosicaoPainel } from "../lib/preferencias-painel";
import { unir_classes } from "../lib/unir-classes";

function normalizar_whatsapp(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function TelaConfiguracoes() {
  const { usuario, definir_usuario, sair } = useAutenticacao();
  const contexto = useContextoLayout();
  const [nome, setNome] = useState(usuario?.nome ?? "");
  const [whatsapp, setWhatsapp] = useState(usuario?.whatsappNumero ?? "");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [salvandoWhatsapp, setSalvandoWhatsapp] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    setNome(usuario?.nome ?? "");
    setWhatsapp(usuario?.whatsappNumero ?? "");
  }, [usuario]);

  if (!usuario) return null;

  const usuarioId = usuario.id;
  const nomeAtual = usuario.nome;
  const whatsappAtual = usuario.whatsappNumero ?? "";

  async function salvar_perfil(evento: FormEvent) {
    evento.preventDefault();
    if (!nome.trim()) return;
    setSalvandoPerfil(true);
    setErro(null);
    setOk(null);
    try {
      const atualizado = await clienteApi.atualizar_usuario(usuarioId, { nome: nome.trim() });
      definir_usuario(atualizado);
      setOk("Nome atualizado.");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar o perfil.");
    } finally {
      setSalvandoPerfil(false);
    }
  }

  async function salvar_whatsapp(evento: FormEvent) {
    evento.preventDefault();
    const digitos = normalizar_whatsapp(whatsapp);
    if (digitos.length < 10 || digitos.length > 15) {
      setErro("Informe o WhatsApp com DDI e DDD, só números (10 a 15 dígitos).");
      return;
    }
    setSalvandoWhatsapp(true);
    setErro(null);
    setOk(null);
    try {
      const atualizado = await clienteApi.atualizar_usuario(usuarioId, {
        whatsappNumero: digitos,
      });
      definir_usuario(atualizado);
      setWhatsapp(atualizado.whatsappNumero ?? digitos);
      setOk("WhatsApp vinculado.");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível vincular o WhatsApp.");
    } finally {
      setSalvandoWhatsapp(false);
    }
  }

  async function desvincular_whatsapp() {
    setSalvandoWhatsapp(true);
    setErro(null);
    setOk(null);
    try {
      const atualizado = await clienteApi.atualizar_usuario(usuarioId, {
        whatsappNumero: null,
      });
      definir_usuario(atualizado);
      setWhatsapp("");
      setOk("WhatsApp desvinculado.");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível desvincular.");
    } finally {
      setSalvandoWhatsapp(false);
    }
  }

  async function definir_posicao(posicao: PosicaoPainel) {
    setErro(null);
    setOk(null);
    try {
      await contexto?.definirPosicaoPainel(posicao);
      setOk("Posição do assistente salva na sua conta.");
    } catch {
      setErro("Não foi possível salvar a posição do assistente.");
    }
  }

  const posicaoAtual = contexto?.posicaoPainel ?? usuario.posicaoPainel ?? "lateral";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-texto">Configurações</h1>
        <p className="text-sm text-texto-suave">Conta, WhatsApp e preferências do assistente</p>
      </div>

      {erro && (
        <div className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-texto">
          {erro}
        </div>
      )}
      {ok && (
        <div className="rounded-lg border border-primaria/40 bg-primaria/10 px-3 py-2 text-sm text-texto">
          {ok}
        </div>
      )}

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={(e) => void salvar_perfil(e)}
        className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
      >
        <div className="flex items-center gap-2 text-texto">
          <UserRound size={16} className="text-primaria" />
          <p className="text-sm font-medium">Conta</p>
        </div>
        <label className="flex flex-col gap-1 text-xs text-texto-suave">
          Nome
          <Campo value={nome} onChange={(e) => setNome(e.target.value)} required minLength={1} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-texto-suave">
          E-mail
          <Campo value={usuario.email} disabled readOnly />
        </label>
        <div className="flex justify-end">
          <Botao type="submit" disabled={salvandoPerfil || nome.trim() === nomeAtual}>
            {salvandoPerfil ? "Salvando..." : "Salvar nome"}
          </Botao>
        </div>
      </motion.form>

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 }}
        onSubmit={(e) => void salvar_whatsapp(e)}
        className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
      >
        <div className="flex items-center gap-2 text-texto">
          <MessageCircle size={16} className="text-primaria" />
          <p className="text-sm font-medium">WhatsApp</p>
        </div>
        <p className="text-xs text-texto-suave">
          Só números autorizados aqui conversam com o assistente. Use DDI + DDD, só dígitos (ex.:
          5511999999999).
        </p>
        <label className="flex flex-col gap-1 text-xs text-texto-suave">
          Número
          <Campo
            placeholder="5511999999999"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <p className="text-xs text-texto-suave">
          Status:{" "}
          {whatsappAtual ? (
            <span className="text-texto">vinculado ({whatsappAtual})</span>
          ) : (
            <span>não vinculado</span>
          )}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {whatsappAtual && (
            <Botao
              type="button"
              variante="fantasma"
              disabled={salvandoWhatsapp}
              onClick={() => void desvincular_whatsapp()}
            >
              Desvincular
            </Botao>
          )}
          <Botao
            type="submit"
            disabled={
              salvandoWhatsapp ||
              normalizar_whatsapp(whatsapp) === whatsappAtual ||
              !whatsapp.trim()
            }
          >
            {salvandoWhatsapp ? "Salvando..." : "Vincular"}
          </Botao>
        </div>
      </motion.form>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie/80 p-4"
      >
        <div className="flex items-center gap-2 text-texto">
          <PanelRight size={16} className="text-primaria" />
          <p className="text-sm font-medium">Assistente</p>
        </div>
        <p className="text-xs text-texto-suave">
          Posição do painel na sua conta — vale em qualquer dispositivo.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "lateral", rotulo: "Lateral" },
              { id: "inferior", rotulo: "Inferior" },
            ] as const
          ).map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              onClick={() => void definir_posicao(opcao.id)}
              className={unir_classes(
                "rounded-lg border px-3 py-2 text-sm transition",
                posicaoAtual === opcao.id
                  ? "border-primaria bg-primaria/15 text-primaria"
                  : "border-borda text-texto-suave hover:bg-superficie-alta hover:text-texto",
              )}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>
        <p className="text-xs text-texto-suave">
          Bancos e sync:{" "}
          <Link to="/conexoes" className="text-primaria hover:underline">
            abrir Conexões
          </Link>
        </p>
      </motion.section>

      <div className="flex justify-end md:hidden">
        <Botao variante="fantasma" onClick={() => void sair()}>
          Sair da conta
        </Botao>
      </div>
    </div>
  );
}
