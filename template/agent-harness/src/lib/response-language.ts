type ResponseLanguage = 'zh-CN' | 'en' | 'und';

export interface ResponseLanguageContext {
  currentExplicit?: Exclude<ResponseLanguage, 'und'>;
  persisted?: {
    language: Exclude<ResponseLanguage, 'und'>;
    evidence: 'explicit' | 'observed';
  };
}

export interface ResponseLanguageDecision {
  language: ResponseLanguage;
  source:
    | 'current-explicit'
    | 'persistent-explicit'
    | 'persistent-observed'
    | 'detected'
    | 'undetermined';
  profileMutation: 'none';
}

function detectedLanguage(query: string): ResponseLanguage {
  if (/\p{Script=Han}/u.test(query)) return 'zh-CN';
  if (/\p{Script=Latin}/u.test(query)) return 'en';
  return 'und';
}

export function resolveResponseLanguage(
  query: string,
  context: ResponseLanguageContext = {},
): ResponseLanguageDecision {
  if (context.currentExplicit) {
    return {
      language: context.currentExplicit,
      source: 'current-explicit',
      profileMutation: 'none',
    };
  }
  if (context.persisted) {
    if (!['explicit', 'observed'].includes(context.persisted.evidence)) {
      throw new Error('Persistent language evidence must be explicit or observed');
    }
    return {
      language: context.persisted.language,
      source: `persistent-${context.persisted.evidence}`,
      profileMutation: 'none',
    };
  }
  const language = detectedLanguage(query);
  return {
    language,
    source: language === 'und' ? 'undetermined' : 'detected',
    profileMutation: 'none',
  };
}
