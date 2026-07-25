import { describe, expect, it } from 'vitest';
import {
  LANG_NAMES,
  LangCode,
  detectLanguage,
  detectLanguageMix,
  sharePct,
} from './language-detect';

/** The top-voted language for a snippet. */
function top(text: string, meta?: string | null): LangCode {
  return detectLanguage(text, meta)[0].lang;
}

describe('detectLanguage — script tier', () => {
  it('detects Japanese from kana', () => {
    expect(top('これはテストです')).toBe('ja');
  });

  it('detects Japanese when kanji mixes with kana', () => {
    expect(top('今日はいい天気ですね')).toBe('ja');
  });

  it('detects Korean from hangul', () => {
    expect(top('안녕하세요 반갑습니다')).toBe('ko');
  });

  it('detects Chinese from han without kana', () => {
    expect(top('这是一个测试')).toBe('zh');
  });

  it('detects Russian from cyrillic', () => {
    expect(top('это простой тест')).toBe('ru');
  });

  it('refines cyrillic to Ukrainian when unique letters appear', () => {
    expect(top('це український текст із літерою ї')).toBe('uk');
  });

  it('detects Greek, Arabic, Hebrew, Thai, Hindi by script', () => {
    expect(top('αυτό είναι ελληνικά')).toBe('el');
    expect(top('هذا نص عربي')).toBe('ar');
    expect(top('זהו טקסט עברי')).toBe('he');
    expect(top('นี่คือข้อความภาษาไทย')).toBe('th');
    expect(top('यह हिंदी पाठ है')).toBe('hi');
  });
});

describe('detectLanguage — Latin stop-word tier', () => {
  it('detects English', () => {
    expect(top('the quick brown fox is in the house and that is all we have')).toBe('en');
  });

  it('detects German', () => {
    expect(top('das ist ein test und die katze ist auf dem tisch')).toBe('de');
  });

  it('detects French', () => {
    expect(top('le chat est dans la maison et je ne sais pas pourquoi')).toBe('fr');
  });

  it('detects Spanish', () => {
    expect(top('el gato está en la casa y no sé por qué pero es así')).toBe('es');
  });

  it('detects Portuguese', () => {
    expect(top('o gato está na casa e não sei por que mas é assim mais uma vez')).toBe('pt');
  });

  it('detects Swedish', () => {
    expect(top('det är en katt som är på bordet och jag vet inte varför')).toBe('sv');
  });
});

describe('detectLanguage — diacritic hints', () => {
  it('German ß biases toward German', () => {
    expect(top('Straße')).toBe('de');
  });

  it('Spanish ñ biases toward Spanish', () => {
    expect(top('mañana')).toBe('es');
  });

  it('Polish letters bias toward Polish', () => {
    expect(top('źdźbło łąka')).toBe('pl');
  });
});

describe('detectLanguage — metadata prior', () => {
  it('uses the hint when text is too short to signal', () => {
    expect(top('ok', 'fr')).toBe('fr');
  });

  it('normalizes a regioned code', () => {
    expect(top('ok', 'pt-BR')).toBe('pt');
  });

  it('does not let the hint override an obvious script', () => {
    // Declared English, but visibly all Cyrillic.
    expect(top('это текст на русском языке полностью', 'en')).toBe('ru');
  });

  it('ignores an unknown hint code', () => {
    expect(detectLanguage('', 'xx')).toEqual([{ lang: 'und', share: 1 }]);
  });
});

describe('detectLanguage — degenerate input', () => {
  it('returns und for empty text', () => {
    expect(detectLanguage('')).toEqual([{ lang: 'und', share: 1 }]);
  });

  it('returns und-heavy for pure numbers/punctuation', () => {
    expect(top('123 !!! @#$ ...')).toBe('und');
  });

  it('always returns shares that sum to ~1', () => {
    const dist = detectLanguage('the cat und die katze mit ß');
    const sum = dist.reduce((s, d) => s + d.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('detectLanguageMix', () => {
  it('produces a mostly-English, some-German mix', () => {
    const items = [
      { text: 'the quick brown fox is in the house and that is all we have here' },
      { text: 'we are having a great time and this is the best day of the year' },
      { text: 'you can see that the weather is nice and we are all very happy' },
      { text: 'das ist ein test und die katze ist auf dem tisch mit dem hund' },
    ];
    const mix = detectLanguageMix(items);
    expect(mix[0].lang).toBe('en');
    expect(mix.some((m) => m.lang === 'de')).toBe(true);
    expect(mix.find((m) => m.lang === 'en')!.share).toBeGreaterThan(
      mix.find((m) => m.lang === 'de')!.share,
    );
  });

  it('folds slivers below minShare into und', () => {
    const items = Array.from({ length: 100 }, () => ({
      text: 'the quick brown fox is in the house and that is all we have here',
    }));
    items.push({ text: 'mañana' }); // ~1% Spanish sliver
    const mix = detectLanguageMix(items, 0.05);
    expect(mix.some((m) => m.lang === 'es')).toBe(false);
    expect(mix.find((m) => m.lang === 'und')).toBeTruthy();
  });

  it('shares sum to ~1', () => {
    const mix = detectLanguageMix([
      { text: 'the cat is here' },
      { text: 'これはテスト' },
      { text: 'le chat est ici' },
    ]);
    expect(mix.reduce((s, m) => s + m.share, 0)).toBeCloseTo(1, 5);
  });

  it('returns und for an all-empty sample', () => {
    expect(detectLanguageMix([{ text: '   ' }, { text: '' }])).toEqual([{ lang: 'und', share: 1 }]);
  });

  it('honors per-item metadata hints', () => {
    const mix = detectLanguageMix([
      { text: 'ok', meta: 'ja' },
      { text: 'sure', meta: 'ja' },
    ]);
    expect(mix[0].lang).toBe('ja');
  });
});

describe('helpers', () => {
  it('every LangCode has a display name', () => {
    for (const code of Object.keys(LANG_NAMES) as LangCode[]) {
      expect(LANG_NAMES[code]).toBeTruthy();
    }
  });

  it('sharePct never rounds a present language to 0', () => {
    expect(sharePct(0.001)).toBe(1);
    expect(sharePct(0.5)).toBe(50);
    expect(sharePct(1)).toBe(100);
  });
});
