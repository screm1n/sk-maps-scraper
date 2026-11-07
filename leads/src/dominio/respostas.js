/**
 * Tells an auto-reply ("Thanks for your message, we'll get back soon") from a person.
 * A bot answering is not interest and would inflate the reply rate, so it is only noted.
 */
const AUTOMATICA = [
  // pt
  /agrade[cç][eo](mos)? (o |pelo )?(seu )?contato/,
  /obrigad[oa] (por (entrar em )?contat|pel[oa] (seu )?contat)/,
  /em breve (retornaremos|responderemos|entraremos|um de nossos)/,
  /(nosso )?horario de atendimento/,
  /assim que possivel (retornaremos|responderemos)/,
  /mensagem automatica/,
  /seja bem[- ]vind[oa]/,
  /digite (o numero|1|uma das opcoes)/,
  /escolha uma (das )?opc/,
  /sou (a|o) assistente virtual/,
  /aguarde (um )?(instante|momento|so um pouco)/,
  /(estou|esteja|estamos) em atendimento/,
  // es
  /gracias por (tu|su) mensaje/,
  /(te|le) responderemos (pronto|en breve)/,
  /horario de atencion/,
  /mensaje automatico/,
  // en
  /thank(s| you) for (your message|contacting|reaching out)/,
  /we('| wi)ll (get back|reply|respond) (to you )?(soon|shortly|as soon)/,
  /(our )?(business|office) hours/,
  /automated (message|reply)/,
  /(currently )?(away|unavailable)/,
];

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const ehAutomatica = (texto) => AUTOMATICA.some((re) => re.test(semAcento(texto)));
