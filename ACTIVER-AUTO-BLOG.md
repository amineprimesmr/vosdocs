# Activer la publication automatique du blog (1 fois)

Le script qui publie un nouvel article tous les 3 jours doit être ajouté sur GitHub (le token du projet n’a pas la permission pour le pousser automatiquement).

## En 3 étapes

1. **Ouvre ce lien** (crée le fichier workflow sur GitHub) :  
   **https://github.com/amineprimesmr/vosdocs/new/main?filename=.github/workflows/blog-publish.yml**

2. **Colle le contenu ci‑dessous** dans l’éditeur (remplace tout ce qui est pré-rempli).

3. Clique sur **Commit new file**. C’est tout.

---

## Contenu à coller

```yaml
name: Blog - Publication automatique

permissions:
  contents: write

on:
  schedule:
    - cron: '0 8 */3 * *'
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: node scripts/publish-next-blog.js
        continue-on-error: true
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add content/blog-articles.json content/blog-calendar.json public/blog/
          git diff --staged --quiet || (git commit -m "Blog: publication auto [skip ci]" && git push)
```

---

Après ça, un nouvel article du calendrier sera publié automatiquement tous les 3 jours, et tu pourras aussi lancer une publication à la main dans **Actions** → « Blog - Publication automatique » → **Run workflow**.
