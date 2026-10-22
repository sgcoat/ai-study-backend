import { setTimeout } from 'node:timers/promises';
import type { AIProvider } from './provider.js';
import type { GenerationConfig, ImageRow, Material, Question, QuestionDraft, Summary, SummaryDraft } from '../types.js';

export class MockAIProvider implements AIProvider {
  readonly modelInfo = 'mock-server-v1';
  constructor(private delay: number) {}
  async summarize(material: Material, images: ImageRow[], signal: AbortSignal): Promise<SummaryDraft> {
    await setTimeout(this.delay, undefined, { signal });
    const points = material.content.split(/\n+/).map((line) => line.trim().replace(/^\d+[.)]\s*/, '')).filter(Boolean).slice(0, 8)
      .map((line) => line.length > 400 ? `${line.slice(0, 400)}…` : line);
    if (!points.length) points.push(`이미지 ${images.length}장이 등록되었습니다. 서버 예시 모드는 필기를 인식하지 않습니다. 실제 이미지 요약은 OpenAI 모드에서 제공됩니다.`);
    const keyTerms = points.flatMap((point) => {
      const colon = point.indexOf(':');
      return colon > 0 && colon < 40 ? [{ term: point.slice(0, colon).trim(), definition: point.slice(colon + 1).trim() }] : [];
    });
    return { content: points.map((point) => `• ${point}`).join('\n'), coreConcepts: points.slice(0, 4), keyTerms,
      sections: [{ title: material.title, content: '', bulletPoints: points }] };
  }
  async questions(summary: Summary, config: GenerationConfig, signal: AbortSignal): Promise<QuestionDraft[]> {
    await setTimeout(this.delay, undefined, { signal });
    const points = summary.structuredContent.coreConcepts.length ? summary.structuredContent.coreConcepts : [summary.content];
    const terms = summary.structuredContent.keyTerms;
    return Array.from({ length: config.count }, (_, index): QuestionDraft => {
      const type = config.types[index % config.types.length]!;
      const point = points[index % points.length]!;
      const term = terms[index % Math.max(1, terms.length)];
      const explanation = `요약에서 확인할 수 있는 내용: ${point}`;
      if (type === 'MULTIPLE_CHOICE') {
        const options = [point, '이 자료에는 학습 개념이 없다.', '요약은 원본 자료와 관계가 없다.', '핵심 개념을 복습할 필요가 없다.'];
        const choices = options.map((_, i) => options[(i + index) % 4]!);
        return { type, content: '자료 요약에 포함된 내용을 고르세요.', choices, answer: String(choices.indexOf(point) + 1), explanation };
      }
      if (type === 'OX') return { type, content: index % 2 ? `요약은 다음 내용의 반대가 사실이라고 설명한다.\n${point}` :
        `다음 내용은 요약에 포함되어 있다.\n${point}`, choices: [], answer: index % 2 ? 'X' : 'O', explanation };
      if (type === 'SHORT_ANSWER') return { type, content: term ? `다음 설명에 해당하는 용어는?\n${term.definition}` : `다음 제시문을 그대로 쓰세요.\n${point}`,
        choices: [], answer: term?.term ?? point, explanation };
      if (type === 'CONCEPT_COMPARISON') {
        const other = points[(index + 1) % points.length]!;
        return { type, content: `두 내용을 비교해 설명하세요.\n① ${point}\n② ${other}`, choices: [], answer: `${point}\n${other}`,
          explanation: '각 내용의 특징을 함께 확인해 보세요. 예시 모드에서는 모범 답안과 문자가 일치하는지 확인합니다.' };
      }
      return { type, content: term ? `${term.term}의 의미를 설명하세요.` : `다음 개념을 다시 설명하세요.\n${point}`,
        choices: [], answer: term?.definition ?? point, explanation };
    });
  }
  async grade(question: Question, submittedAnswer: string) {
    const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    return { isCorrect: normalize(question.answer) === normalize(submittedAnswer), explanation: '개발용 문자열 비교 채점입니다.' };
  }
}
