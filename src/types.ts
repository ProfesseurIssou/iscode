/* eslint-disable @typescript-eslint/naming-convention */

/*SNIPPET D'AUTOCOMPLETION*/
export interface Snippet {
    output: string,
    documentation?: string,
    commitChars?: Array<string> | null
}

/*ENTREE DE RENDU : une ligne de sortie, placée dans une zone (head/body/tail...)*/
export interface RenderEntry {
    zone: string,
    line: string | Array<string>
}

/*CIBLE DE TRADUCTION : fichier de sortie, grammaire de rendu (par défaut celle du niveau courant), cible de rendu, émission du header*/
export interface TargetDef {
    extension: string,
    grammar?: string,
    target?: string,
    emitHeader?: boolean
}

/*DEFINITION D'UNE INSTRUCTION DU LANGAGE*/
export interface Instruction {
    syntax: Array<string>,                          /*liste ordonnée des tokens composant la syntaxe*/
    ast: { [key: string]: any },                    /*template du noeud d'AST construit (placeholders %{n} = captures de la regex)*/
    snippet: Snippet | null,
    translation: { [target: string]: Array<RenderEntry> }
}
export interface Instructions {
    [key: string]: Instruction
}

/*DEFINITION D'UN NIVEAU DE LANGAGE (une version = un fichier convert/<niveau>/v<version>.json)*/
export interface LanguageJson {
    name: string,
    version: number,
    renderZoneOrder?: Array<string>,                /*ordre d'assemblage des zones de sortie*/
    pipeline?: Array<string>,                       /*passes AST -> AST appliquées avant le rendu*/
    target?: { level: string, version: string | number }, /*niveau attendu par le fichier produit*/
    availableTranslation: { [name: string]: TargetDef },
    tokens: { [key: string]: string },
    instructions: Instructions
}

/*PROVENANCE D'UN NOEUD : permet de retrouver la ligne source depuis n'importe quelle étape (source maps)*/
export interface Origin {
    file: string,
    line: number,                                   /*ligne dans le fichier source (1-based)*/
    level: string,
    version: number
}

/*NOEUD D'AST : champs libres définis par le template "ast" de l'instruction*/
export interface AstNode {
    op: string,
    origin: Origin,
    _indent?: string,                               /*indentation d'origine, réappliquée en zone body*/
    _instruction?: string,                          /*instruction d'origine (rendu exact), les passes n'en ont pas*/
    [key: string]: any
}

export interface ParseError {
    line: number,
    text: string
}
export interface ParseResult {
    nodes: Array<AstNode>,
    errors: Array<ParseError>
}

/*SOURCE MAP : ligne du fichier de sortie -> provenance dans le fichier source*/
export interface SourceMapEntry {
    file: string,
    level: string,
    version: number,
    line: number
}
export interface SourceMap {
    [outputLine: string]: SourceMapEntry
}
export interface RenderResult {
    text: string,
    map: SourceMap
}
