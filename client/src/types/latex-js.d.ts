declare module 'latex.js' {
  export class HtmlGenerator {
    constructor(options?: { hyphenate?: boolean; documentClass?: string });
    domFragment(): DocumentFragment;
  }

  export function parse(
    input: string,
    options: { generator: HtmlGenerator },
  ): HtmlGenerator;
}
