# Reste à faire

État au 25 novembre 2026. Ce fichier est exclu du paquet de l'extension (`.vscodeignore`).

## Dépendances : 7 vulnérabilités en production

Mesure : `npm audit --omit=dev` (2 hautes, 1 modérée, 4 faibles). Ne pas lancer `npm audit fix --force`.

| Paquet | Gravité | Blocage | Piste |
|---|---|---|---|
| `xlsx` 0.18.5 | haute | aucun correctif sur npm | version corrigée sur le site de SheetJS (hors registre npm, à valider avant téléchargement), ou remplacer la bibliothèque |
| `image-size` | haute | copie intégrée dans le fichier livré par `vscode-html-to-docx` | attendre une nouvelle version de cette bibliothèque, ou la remplacer |
| `file-type` 19.6.0 | modérée | la version corrigée demande Node 22, alors que `engines.vscode` autorise des éditeurs plus anciens | relever `engines.vscode`, puis mettre à jour |
| `katex` 0.16.47 | faible | la version corrigée change les classes CSS des formules : la mise en forme des exports casse | mettre à jour en même temps le CSS, les polices et le JS de `vditor/src/js/katex`, ainsi que l'URL `katex@0.16.2` de `src/service/markdown/markdown-pdf.js`, puis retester les exports |
| `mermaid` | faible | signalé à cause de `katex` ; la version 12.3.0 demande Node 22.12 | suivre `katex` |
| `fast-xml-parser`, `@mind-elixir/import-xmind` | faible | `import-xmind` embarque son propre parseur | attendre une nouvelle version de `import-xmind` |

## Décisions à prendre

- Identité de l'extension : l'éditeur `cweijan` et la version 4.3.0 sont conservés. Une mise à jour de la marketplace peut donc écraser la version locale. En attendant, désactiver la mise à jour automatique de l'extension, ou changer d'éditeur et de version.
- CSP de l'éditeur Markdown : non ajoutée, à cause du risque de casser l'éditeur (images à chemin absolu, scripts intégrés). À traiter avec des tests d'interface.

## Défauts connus

Présents avant les correctifs de novembre 2026 :

- L'enregistrement CSV ou TSV convertit les fins de ligne Windows (CRLF) en LF et retire le dernier saut de ligne.
- L'enregistrement CSV ou TSV ne garde que la première feuille, sans avertissement.
- En `.xlsx`, les formules sont enregistrées sans leur résultat calculé. Les outils qui ne recalculent pas peuvent afficher des cellules vides.
- Export Markdown : `mermaid.parse` est asynchrone, donc le `try/catch` de `src/service/markdown/ext/markdown-it-mermaid.js` ne capture pas ses erreurs. Sous Node seul, l'appel échoue avec `purify_default.addHook is not a function`. Retirer cet appel permettrait aussi de ne plus embarquer `mermaid` côté extension.
- `Excel.tsx` : un avertissement de lint sur les dépendances d'un `useEffect` (`handleAutoFitColumns`).

Signalés par une analyse automatique, non vérifiés :

- Les images EMF ou WMF d'un `.xlsx` sont réécrites avec l'extension `.png`.
- Les écouteurs `window` de la vue Excel s'accumulent à chaque rechargement.
- Les `.xlsx` enregistrés ne sont pas compressés.
- Annuler « Enregistrer sous » grise le bouton Enregistrer.

## À vérifier à la main

- Éditeur Markdown : coller, ouvrir un lien web ou e-mail, insérer une image.
- Visionneuses EPUB et XMind (`@xmldom/xmldom` et `ag-psd` ont été mis à jour ; seul le PSD a été testé à l'écran).
- Confirmation avant d'écraser un `.xls` ou un `.ods`.
- Bouton de changement d'éditeur sur un CSV.
- Export Markdown lancé depuis Cursor (testé seulement hors de l'éditeur).
- Version web de l'extension.
- Intégration continue sur GitHub avec Node 20.
