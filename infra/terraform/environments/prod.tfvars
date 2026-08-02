# production environment values. TODO(you): fill project_id + github_repo.
project_id    = "TODO-paymax-prod"
environment   = "prod"
region        = "europe-west1"
min_instances = 1 # keep 1 warm — no cold starts on the money path
max_instances = 30
github_repo   = "paymax2022/spotlight-latest"
