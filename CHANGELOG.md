# Change Log

All notable changes to the "iscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release

## [0.3.2]

- isc0 : `include print` n'injecte plus que la routine d'affichage (une seule fois, en fin de fichier) ; nouvelle instruction `print <expr>` qui place la chaîne dans `rsi` et appelle `print`
- README : exemple complet de test de la conversion depuis un nouveau dossier, explication du rôle des source maps

## [0.3.1]

- CLI de traduction sans VS Code : `npm run translate -- <fichier> [cible]` (écrit le fichier traduit + sa source map)
- Tests du pipeline robustes aux checkouts CRLF (git autocrlf)

## [0.3.0] - 2026-08-28

### Architecture : pipeline AST (remplace la traduction ligne par ligne)
- Nouveau pipeline : parse (regex des grammaires JSON) → AST → passes TypeScript → rendu par zones
- Les nœuds d'AST portent leur origine (fichier + ligne source) : **source maps** `.map` générées à chaque traduction
- Rendu par **zones** (head/body/tail) : une instruction peut générer plusieurs lignes, y compris en dehors de sa position (ex : `include print` injecte la routine d'affichage en fin de fichier)
- Placeholders nommés dans les templates de rendu (`%{dst}`, `%{src}`...) en plus des `%{n}` du parse

### Gestion des versions de langage
- Grammaires versionnées : `convert/<niveau>/v<version>.json` (anciens `convert/isc0.json` et `isc1.json` déplacés en `v1.json`)
- En-tête de source `#! iscode-level:` / `#! iscode-version:` ; sans en-tête, rétro-compatibilité (extension du fichier + dernière version)
- Les fichiers générés de niveau ISCode embarquent leur en-tête : ils sont re-traduisibles tels quels

### Corrections
- Token `TypeTen` manquant dans la grammaire isc0 (les instructions `ten`/`reserve ten` ne matchaient jamais)
- Le placeholder obsolète `%7` dans la traduction isc1 est remplacé par la passe `resolveParams`
- Les lignes non reconnues sont collectées et signalées en un seul message (la traduction continue, comme avant)
- Token manquant dans une grammaire : erreur explicite au lieu d'une regex contenant `(undefined)`

### Autre
- `include print` : nouvelle instruction (routine print NASM x64 injectée en zone tail)
- Tests du pipeline : `npm run test:pipeline` + exemples dans `samples/`
- Documentation du format JSON v2 et diagrammes d'architecture dans le README