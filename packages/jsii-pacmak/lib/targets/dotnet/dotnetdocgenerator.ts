import * as spec from '@jsii/spec';
import { CodeMaker } from 'codemaker';
import {
  Rosetta,
  TargetLanguage,
  enforcesStrictMode,
  markDownToXmlDoc,
  ApiLocation,
} from 'jsii-rosetta';
import * as xmlbuilder from 'xmlbuilder';

import { renderSummary } from '../_utils';
import { DotNetNameUtils } from './nameutils';

/**
 * Generates the Jsii attributes and calls for the .NET runtime
 *
 * Uses the same instance of CodeMaker as the rest of the code
 */
export class DotNetDocGenerator {
  private readonly code: CodeMaker;
  private readonly nameutils: DotNetNameUtils = new DotNetNameUtils();

  public constructor(
    code: CodeMaker,
    private readonly rosetta: Rosetta,
    private readonly assembly: spec.Assembly,
  ) {
    this.code = code;
  }

  /**
   * Emits all documentation depending on what is available in the jsii model
   *
   * Used by all kind of members + classes, interfaces, enums
   * Order should be
   * Summary
   * Param
   * Returns
   * Remarks (includes examples, links, deprecated)
   */
  public emitDocs(obj: spec.Documentable, apiLocation: ApiLocation): void {
    const docs = obj.docs;

    // The docs may be undefined at the method level but not the parameters level
    this.emitXmlDoc('summary', renderSummary(obj.docs));

    // Handling parameters only if the obj is a method
    const objMethod = obj as spec.Method;
    if (objMethod.parameters) {
      objMethod.parameters.forEach((param) => {
        // Remove any slug `@` from the parameter name - it's not supposed to show up here.
        const paramName = this.nameutils
          .convertParameterName(param.name)
          .replace(/^@/, '');
        this.emitXmlDoc('param', param.docs?.summary ?? '', {
          attributes: { name: paramName },
        });
      });
    }

    // At this pdocfx namespacedocd a valid instance of docs
    if (!docs) {
      return;
    }

    if (docs.returns) {
      this.emitXmlDoc('returns', docs.returns);
    }

    // Remarks does not use emitXmlDoc() because the remarks can contain code blocks
    // which are fenced with <code> tags, which would be escaped to
    // &lt;code&gt; if we used the xml builder.
    const remarks = this.renderRemarks(docs, apiLocation);
    if (remarks.length > 0) {
      this.code.line('/// <remarks>');
      remarks.forEach((r) => this.code.line(`/// ${r}`.trimRight()));
      this.code.line('/// </remarks>');
    }

    if (docs.example) {
      this.code.line('/// <example>');
      this.emitXmlDoc('code', this.convertExample(docs.example, apiLocation));
      this.code.line('/// </example>');
    }
  }

  public emitMarkdownAsRemarks(
    markdown: string | undefined,
    apiLocation: ApiLocation,
  ) {
    if (!markdown) {
      return;
    }

    const translated = markDownToXmlDoc(
      this.convertSamplesInMarkdown(markdown, apiLocation),
    );
    const lines = translated.split('\n');

    this.code.line('/// <remarks>');
    for (const line of lines) {
      this.code.line(`/// ${line}`.trimRight());
    }
    this.code.line('/// </remarks>');
  }

  /**
   * Returns the lines that should go into the <remarks> section
   */
  private renderRemarks(docs: spec.Docs, apiLocation: ApiLocation): string[] {
    const ret: string[] = [];

    if (docs.remarks) {
      const translated = markDownToXmlDoc(
        this.convertSamplesInMarkdown(docs.remarks, apiLocation),
      );
      ret.push(...translated.split('\n'));
      ret.push('');
    }

    // All the "tags" need to be rendered with empyt lines between them or they'll be word wrapped.

    if (docs.default) {
      emitDocAttribute('default', docs.default);
    }
    if (docs.stability && shouldMentionStability(docs.stability)) {
      emitDocAttribute(
        'stability',
        this.nameutils.capitalizeWord(docs.stability),
      );
    }
    if (docs.see) {
      emitDocAttribute('see', docs.see);
    }
    if (docs.subclassable) {
      emitDocAttribute('subclassable', '');
    }
    for (const [k, v] of Object.entries(docs.custom ?? {})) {
      const extraSpace = k === 'link' ? ' ' : ''; // Extra space for '@link' to keep unit tests happy
      emitDocAttribute(k, v + extraSpace);
    }

    // Remove leading and trailing empty lines
    while (ret.length > 0 && ret[0] === '') {
      ret.shift();
    }
    while (ret.length > 0 && ret[ret.length - 1] === '') {
      ret.pop();
    }

    return ret;

    function emitDocAttribute(name: string, contents: string) {
      const ls = contents.split('\n');
      ret.push(`<strong>${ucFirst(name)}</strong>: ${ls[0]}`);
      ret.push(...ls.slice(1));
      ret.push('');
    }
  }

  private convertExample(example: string, apiLocation: ApiLocation): string {
    const translated = this.rosetta.translateExample(
      apiLocation,
      example,
      TargetLanguage.CSHARP,
      enforcesStrictMode(this.assembly),
    );
    return translated.source;
  }

  private convertSamplesInMarkdown(markdown: string, api: ApiLocation): string {
    return this.rosetta.translateSnippetsInMarkdown(
      api,
      markdown,
      TargetLanguage.CSHARP,
      enforcesStrictMode(this.assembly),
    );
  }
  private emitXmlDoc(
    tag: string,
    content: string,
    { attributes = {} }: { attributes?: { [name: string]: string } } = {},
  ): void {
    if (!content) {
      return;
    }

    const xml = xmlbuilder.create(tag, { headless: true }).text(content);
    for (const [name, value] of Object.entries(attributes)) {
      xml.att(name, value);
    }
    const xmlstring = xml.end({ allowEmpty: true, pretty: false });
    const trimLeft = tag !== 'code';
    for (const line of xmlstring
      .split('\n')
      .map((x) => (trimLeft ? x.trim() : x.trimRight()))) {
      this.code.line(`/// ${line}`);
    }
  }
}

/**
 * Uppercase the first letter
 */
function ucFirst(x: string) {
  return x.substr(0, 1).toUpperCase() + x.substr(1);
}

function shouldMentionStability(s: spec.Stability) {
  // Don't render "stable" or "external", those are both stable by implication
  return s === spec.Stability.Deprecated || s === spec.Stability.Experimental;
}
