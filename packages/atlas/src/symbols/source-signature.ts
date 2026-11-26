import { TypeScriptCompiler } from '@/common/compiler';
import type TypeScript from 'typescript';

/**
 * The signature of an export declared in a TypeScript source file. A declaration file holds no values, a source
 * file does (function bodies, initializers, default arguments, the expression of `export default`), so this builds
 * the text from the parts that are types or names and never quotes a statement: a value cannot reach a record.
 */
export class SourceSignature {
  static of(opts: { declaration: TypeScript.Declaration; name: string }): string {
    const compiler = TypeScriptCompiler.get();
    const { declaration, name } = opts;
    const file = declaration.getSourceFile();
    const text = (node?: TypeScript.Node): string => (node === undefined ? '' : node.getText(file));
    const typeParameters = (nodes?: TypeScript.NodeArray<TypeScript.TypeParameterDeclaration>) =>
      nodes === undefined || nodes.length === 0 ? '' : `<${nodes.map(text).join(', ')}>`;

    if (compiler.isFunctionDeclaration(declaration)) {
      const returns = declaration.type === undefined ? '' : `: ${text(declaration.type)}`;

      return `function ${name}${typeParameters(declaration.typeParameters)}(${SourceSignature.parametersOf({ declaration })})${returns}`;
    }

    if (compiler.isClassDeclaration(declaration) || compiler.isInterfaceDeclaration(declaration)) {
      const keyword = compiler.isClassDeclaration(declaration) ? 'class' : 'interface';
      const heritage = (declaration.heritageClauses ?? [])
        .map((clause) => SourceSignature.heritageOf({ clause, file }))
        .join(' ');
      const head = `${keyword} ${name}${typeParameters(declaration.typeParameters)}`;

      return heritage === '' ? head : `${head} ${heritage}`;
    }

    if (compiler.isTypeAliasDeclaration(declaration)) {
      return `type ${name}${typeParameters(declaration.typeParameters)} = ${text(declaration.type)}`;
    }

    if (compiler.isEnumDeclaration(declaration)) {
      return `enum ${name}`;
    }

    if (compiler.isModuleDeclaration(declaration) || compiler.isSourceFile(declaration)) {
      return `namespace ${name}`;
    }

    if (compiler.isVariableDeclaration(declaration)) {
      const type = declaration.type === undefined ? '' : `: ${text(declaration.type)}`;

      return `const ${name}${type}`;
    }

    // A binding element, `export default <expression>`, a specifier: the name is all that is safe to say.
    return `export ${name}`;
  }

  /** Names and types of the parameters, with no default value and no destructuring pattern spelled out. */
  private static parametersOf(opts: { declaration: TypeScript.FunctionDeclaration }): string {
    const compiler = TypeScriptCompiler.get();
    const file = opts.declaration.getSourceFile();

    return opts.declaration.parameters
      .map((parameter) => {
        const rest = parameter.dotDotDotToken === undefined ? '' : '...';
        const label = compiler.isIdentifier(parameter.name)
          ? parameter.name.text
          : compiler.isObjectBindingPattern(parameter.name)
            ? '{ ... }'
            : '[ ... ]';
        const optional =
          parameter.questionToken !== undefined || parameter.initializer !== undefined ? '?' : '';
        const type = parameter.type === undefined ? '' : `: ${parameter.type.getText(file)}`;

        return `${rest}${label}${optional}${type}`;
      })
      .join(', ');
  }

  /** `extends A<T>` or `implements B`; an expression that is not a plain name (a call, say) is `...`. */
  private static heritageOf(opts: {
    clause: TypeScript.HeritageClause;
    file: TypeScript.SourceFile;
  }): string {
    const compiler = TypeScriptCompiler.get();
    const keyword =
      opts.clause.token === compiler.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
    const types = opts.clause.types.map((item) => {
      const isName =
        compiler.isIdentifier(item.expression) ||
        compiler.isPropertyAccessExpression(item.expression);
      const expression = isName ? item.expression.getText(opts.file) : '...';
      const args =
        item.typeArguments === undefined
          ? ''
          : `<${item.typeArguments.map((argument) => argument.getText(opts.file)).join(', ')}>`;

      return `${expression}${args}`;
    });

    return `${keyword} ${types.join(', ')}`;
  }
}
