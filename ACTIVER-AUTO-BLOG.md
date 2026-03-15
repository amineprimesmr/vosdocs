# Activer la publication automatique du blog (1 fois)

Le script qui publie un nouvel article tous les 3 jours doit être ajouté sur GitHub (le token du projet n'a pas la permission pour le pousser automatiquement).

## En 3 étapes

1. **Ouvre ce lien** (crée le fichier workflow sur GitHub) :  
   **https://github.com/amineprimesmr/carvinguard/new/main?filename=.github/workflows/blog-publish.yml**

2. **Colle le contenu ci‑dessous** dans l'éditeur (remplace tout ce qui est pré-rempli).

3. Clique sur **Commit new file**. C'est tout.

---

## Si le workflow affiche "Failure"

1. **Donner les droits d'écriture au workflow**  
   GitHub → dépôt **carvinguard** → **Settings** → **Actions** → **General** → **Workflow permissions** → coche **Read and write permissions** → **Save**.

2. **Remplacer le workflow** par la version « Contenu corrigé » ci-dessous :  
   **Code** → **.github/workflows/blog-publish.yml** → **Edit** → tout remplacer par le bloc YAML corrigé → **Commit changes**.

3. **Relancer** : **Actions** → « Blog - Publication automatique » → **Run workflow**.

---

## Contenu à coller (version corrigée)

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
      - name: Checkout
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Publier l'article
        run: node scripts/publish-next-blog.js

      - name: Commit et push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add content/blog-articles.json content/blog-calendar.json public/blog/
          if [ -n "$(git status --porcelain)" ]; then
            git commit -m "Blog: publication auto [skip ci]"
            git push https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/${{ github.repository }}.git HEAD:main
          fi
```

---

Après ça, un nouvel article du calendrier sera publié automatiquement tous les 3 jours, et tu pourras aussi lancer une publication à la main dans **Actions** → « Blog - Publication automatique » → **Run workflow**.
