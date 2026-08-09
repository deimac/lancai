import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface DadosPlasticosCartao {
  numero: string;
  validade: string;
  cvv: string;
}

export class ErroDadosPlasticosInvalidos extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDadosPlasticosInvalidos";
  }
}

export class ErroCifragemCartao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroCifragemCartao";
  }
}

function obter_chave(): Buffer {
  const bruto = process.env.CARTAO_DADOS_KEY;
  if (!bruto) {
    throw new ErroCifragemCartao(
      "CARTAO_DADOS_KEY não configurada. Defina 32 bytes em base64 no .env para cifrar dados do cartão.",
    );
  }
  const chave = Buffer.from(bruto, "base64");
  if (chave.length !== 32) {
    throw new ErroCifragemCartao("CARTAO_DADOS_KEY deve ter exatamente 32 bytes em base64.");
  }
  return chave;
}

/** Remove espaços e hífens do número do cartão. */
export function normalizar_numero_cartao(numero: string): string {
  return numero.replace(/[\s-]/g, "");
}

/**
 * Extrai número / validade / CVV de uma frase em linguagem natural.
 * Usado como rede de segurança quando a IA devolve CORRIGIR_CARTAO/CRIAR_CARTAO
 * sem preencher os três campos juntos, mesmo com a mensagem completa.
 */
export function extrair_dados_plasticos_da_mensagem(mensagem: string): Partial<DadosPlasticosCartao> {
  const resultado: Partial<DadosPlasticosCartao> = {};

  const cvvMatch = /\bcvv\s*[:.]?\s*(\d{3,4})\b/i.exec(mensagem);
  if (cvvMatch?.[1]) resultado.cvv = cvvMatch[1];

  const validadeMatch =
    /(?:validade|val\.?|exp\.?)\s*[:.]?\s*(\d{1,2})\s*[/\-]\s*(\d{2}|\d{4})\b/i.exec(mensagem) ??
    /\b(\d{1,2})\s*[/\-]\s*(\d{2}|\d{4})\b/.exec(mensagem);
  if (validadeMatch?.[1] && validadeMatch[2]) {
    resultado.validade = `${validadeMatch[1]}/${validadeMatch[2]}`;
  }

  // Sequência de 13–19 dígitos com espaços/hífens opcionais (evita pegar CVV/dias).
  const candidatos = mensagem.match(/(?:\d[\s\-]*){13,19}/g) ?? [];
  for (const candidato of candidatos) {
    const digitos = normalizar_numero_cartao(candidato);
    if (/^\d{13,19}$/.test(digitos)) {
      resultado.numero = digitos;
      break;
    }
  }

  return resultado;
}

/** Validade no formato MM/AA. */
export function normalizar_validade(validade: string): string {
  const limpa = validade.trim().replace("-", "/");
  const match = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(limpa);
  if (!match) throw new ErroDadosPlasticosInvalidos("Validade inválida. Use o formato MM/AA.");
  const mes = Number(match[1]);
  if (mes < 1 || mes > 12) throw new ErroDadosPlasticosInvalidos("Mês da validade deve ser entre 01 e 12.");
  const anoBruto = match[2]!;
  const ano = anoBruto.length === 4 ? anoBruto.slice(2) : anoBruto;
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

export function validar_luhn(numero: string): boolean {
  let soma = 0;
  let alternar = false;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    let digito = Number(numero[i]);
    if (!Number.isInteger(digito)) return false;
    if (alternar) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    soma += digito;
    alternar = !alternar;
  }
  return soma % 10 === 0;
}

export function validar_dados_plasticos(entrada: {
  numero: string;
  validade: string;
  cvv: string;
}): DadosPlasticosCartao {
  const numero = normalizar_numero_cartao(entrada.numero);
  if (!/^\d{13,19}$/.test(numero)) {
    throw new ErroDadosPlasticosInvalidos("Número do cartão deve ter entre 13 e 19 dígitos.");
  }
  if (!validar_luhn(numero)) {
    throw new ErroDadosPlasticosInvalidos("Número do cartão inválido.");
  }

  const validade = normalizar_validade(entrada.validade);
  const cvv = entrada.cvv.trim();
  if (!/^\d{3,4}$/.test(cvv)) {
    throw new ErroDadosPlasticosInvalidos("CVV deve ter 3 ou 4 dígitos.");
  }

  return { numero, validade, cvv };
}

export function extrair_final4(numero: string): string {
  const normalizado = normalizar_numero_cartao(numero);
  return normalizado.slice(-4);
}

/**
 * Decifra o blob só para obter os 4 últimos dígitos (máscara na UI).
 * Retorna null se não houver payload ou se a decifragem falhar (chave ausente etc.).
 */
export function mascara_final4_do_payload(payloadBase64: string | null | undefined): string | null {
  if (!payloadBase64) return null;
  try {
    return extrair_final4(decifrar_dados_plasticos(payloadBase64).numero);
  } catch {
    return null;
  }
}

/** Cifra o payload plástico. Formato: base64(iv[12] + tag[16] + ciphertext). */
export function cifrar_dados_plasticos(dados: DadosPlasticosCartao): string {
  const chave = obter_chave();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chave, iv);
  const texto = Buffer.from(JSON.stringify(dados), "utf8");
  const cifrado = Buffer.concat([cipher.update(texto), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, cifrado]).toString("base64");
}

export function decifrar_dados_plasticos(payloadBase64: string): DadosPlasticosCartao {
  const chave = obter_chave();
  const buffer = Buffer.from(payloadBase64, "base64");
  if (buffer.length < 28) throw new ErroCifragemCartao("Payload cifrado inválido.");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const cifrado = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", chave, iv);
  decipher.setAuthTag(tag);
  const texto = Buffer.concat([decipher.update(cifrado), decipher.final()]).toString("utf8");
  const dados = JSON.parse(texto) as DadosPlasticosCartao;
  if (!dados.numero || !dados.validade || !dados.cvv) {
    throw new ErroCifragemCartao("Payload cifrado incompleto.");
  }
  return dados;
}

export function preparar_persistencia_plasticos(entrada: {
  numero: string;
  validade: string;
  cvv: string;
}): { final4: string; dadosPlasticosCifrados: string } {
  const dados = validar_dados_plasticos(entrada);
  return {
    final4: extrair_final4(dados.numero),
    dadosPlasticosCifrados: cifrar_dados_plasticos(dados),
  };
}
