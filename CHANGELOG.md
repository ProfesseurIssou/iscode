# Change Log

All notable changes to the "iscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- **Correctif parser** : cache des regex compilées par identité d'objet grammaire (`WeakMap`) au lieu de `nom@version` — une grammaire modifiée pendant une session (draft du Studio, `convert/` édité) n'utilise plus des regex périmées ; les marqueurs d'erreurs se mettent à jour immédiatement

- **ISCode Studio** (`studio/`) : application web (Vite + TypeScript + Monaco) réutilisant le pipeline de l'extension
  - vue **Translate** : éditeur avec coloration générée depuis la grammaire, complétion, erreurs soulignées, traduction temps réel côte à côte, sync source ↔ sortie via les source maps
  - vue **Languages** : niveaux, chaînes de traduction, registry de grammaires HTTP (manifest + cache navigateur + repli hors-ligne) — point de branchement du futur serveur de grammaires
  - vue **Languages** : **arbre de transitions** — graphe SVG (sans dépendance) des niveaux vers leurs cibles et sorties, layout par plus long chemin (sources en haut, sorties en pointillés en bas), drafts surlignés, cibles manquantes marquées ; graphe et layout purs testés (`transitions.ts`)
  - vue **Language Studio** : création de langages — édition de grammaire par **formulaire** (tokens, cibles, instructions avec syntaxe/AST/snippet/traductions, boutons d'ajout, renommages propagés, réordonnancement) ou en JSON validé par schéma, test live (exemple → sorties + AST), validateurs (tokens/traductions manquants, détection d'instructions masquées), export `convert/<niveau>/v<N>.json`
  - formulaire : toutes les références à l'existant en listes de sélection — « render via » et Output level (niveaux disponibles), Output version (versions du niveau), render key (cibles de la grammaire de sortie), passes du pipeline en cases à cocher ; valeurs de champs AST en sélecteur de captures (`n · token`) avec champ texte grisé tant qu'une capture est sélectionnée ; cibles rendant via un autre niveau affichées comme info explicite au lieu d'un compteur d'entrées trompeur
  - refactor : parties pures de la résolution de grammaire extraites dans `src/grammar.ts` (réutilisable navigateur), `language.ts` ré-exporte (extension/CLI/tests inchangés)
  - tests : vitest dans `studio/` (validateurs, monarch, provider, pipeline) + test de fumée navigateur (`studio/scripts/smoke.mjs`)

## [0.4.0]

### Niveau isc2 : lowering if/else + expressions
- Nouveau niveau haut `isc2` : expressions arithmétiques à parenthèses (`x = (a + b) * 2`) et blocs if/else par indentation (`else` au niveau du `if`)
- Passes de lowering : `buildBlocks` (regroupement des corps indentés), `lowerIf` (comparaison + saut conditionnel inversé + labels uniques `.L0`/`.L1` + jmp), `lowerExpressions` (codegen à pile : eval → rax, push/pop, opérations rax/rbx, division signée cqo + idiv)
- Nouveau parser d'expressions récursif (`src/expressions.ts`) : priorités `* /` sur `+ -`, parenthèses, moins unaire
- isc0 enrichi de façon additive (rétro-compatible, reste en v1) : arithmétique asm-style (`x + y` → `add`...), `cmp` sans mot-clé de taille, sauts (`jmp/je/jne/jl/jle/jg/jge/jz/jnz`), labels (`.L0:`)
- Chaîne complète validée : isc2 → isc0 (re-parsable) → nasm, source maps de bout en bout (chaque ligne générée pointe vers sa ligne isc2)
- Sample `samples/main.isc2` + section README dédiée + diagramme de cascade mis à jour

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