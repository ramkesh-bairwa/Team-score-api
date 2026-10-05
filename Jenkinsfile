// CricScore API — CI/CD pipeline
//
// Every build: install, syntax check, OpenAPI check, smoke test (boots the server with JSON storage),
// Docker image build. On the main branch it then deploys to the VPS the same way deploy/docker-deploy.sh
// does (rsync + `docker compose up -d --build`) and verifies https://score.glamofashion.com/health.
//
// Jenkins setup:
//   - Agent with node 22, docker, rsync, ssh and curl
//   - Credential "cricscore-vps-ssh": SSH Username with private key for the VPS (needs the SSH Agent plugin)
//   - The server keeps its own .env, live-stream/.env, data/, logs/ and recordings — never uploaded or deleted
pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 30, unit: 'MINUTES')
  }

  parameters {
    booleanParam(name: 'DEPLOY', defaultValue: true, description: 'Deploy to the VPS (main branch only)')
  }

  environment {
    DEPLOY_HOST    = 'root@187.126.117.103'
    APP_DIR        = '/var/www/cricscore'
    PUBLIC_URL     = 'https://score.glamofashion.com'
    SSH_CREDENTIAL = 'cricscore-vps-ssh'
    IMAGE          = "cricscore-api:${env.BUILD_NUMBER}"
    SMOKE_PORT     = '3999'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install') {
      steps {
        sh 'node --version && npm --version'
        sh 'npm ci --no-audit --no-fund'
      }
    }

    stage('Syntax check') {
      steps {
        sh 'for f in index.js src/*.js; do node --check "$f"; done'
      }
    }

    stage('OpenAPI spec') {
      steps {
        sh '''
          node -e "
            const s = require('./src/openapi');
            if (!s.openapi || !s.paths || !Object.keys(s.paths).length) throw new Error('OpenAPI spec is empty');
            const n = Object.values(s.paths).reduce((c, p) => c + ['get','post','put','patch','delete'].filter(m => p[m]).length, 0);
            console.log('OpenAPI ' + s.openapi + ': ' + n + ' operations documented');
          "
        '''
      }
    }

    stage('Smoke test') {
      steps {
        // JSON storage and no MySQL, so the build agent needs no database
        sh '''
          set -e
          mkdir -p smoke-data
          PORT=$SMOKE_PORT DB_RUN=false STORAGE=json DATA_DIR="$PWD/smoke-data" node index.js > smoke.log 2>&1 &
          echo $! > smoke.pid
          for i in $(seq 1 30); do
            curl -fs "http://localhost:$SMOKE_PORT/health" >/dev/null && break
            sleep 1
          done
          curl -fsS "http://localhost:$SMOKE_PORT/health"; echo
          curl -fsS -o /dev/null "http://localhost:$SMOKE_PORT/"
          curl -fsS -o /dev/null "http://localhost:$SMOKE_PORT/docs"
          curl -fsS "http://localhost:$SMOKE_PORT/openapi.json" | grep -q '"openapi"'
          curl -fsS "http://localhost:$SMOKE_PORT/api/stream-ice" | grep -q iceServers
          curl -fsS -X POST "http://localhost:$SMOKE_PORT/api/live" -H 'Content-Type: application/json' -d '{"hostName":"CI"}' | grep -q '"code"'
          echo "Smoke test passed"
        '''
      }
      post {
        always {
          sh 'if [ -f smoke.pid ]; then kill $(cat smoke.pid) || true; rm -f smoke.pid; fi'
          archiveArtifacts artifacts: 'smoke.log', allowEmptyArchive: true
        }
      }
    }

    stage('Docker build') {
      steps {
        sh 'docker build -t "$IMAGE" .'
      }
      post {
        always {
          sh 'docker rmi "$IMAGE" >/dev/null 2>&1 || true'
        }
      }
    }

    stage('Deploy') {
      when {
        allOf {
          branch 'main'
          expression { params.DEPLOY }
        }
      }
      steps {
        sshagent(credentials: [env.SSH_CREDENTIAL]) {
          sh '''
            set -e
            SSH="ssh -o StrictHostKeyChecking=accept-new"
            rsync -az --delete -e "$SSH" \
              --exclude .git/ --exclude node_modules/ --exclude .next/ \
              --exclude .env --exclude .env.local --exclude data/ --exclude logs/ \
              --exclude live-stream/recordings/ --exclude live-stream/.mysql/ \
              --exclude deploy/.credentials --exclude deploy/last-deploy.log \
              --exclude '*.tsbuildinfo' --exclude .DS_Store \
              --exclude smoke.log --exclude smoke.pid --exclude smoke-data/ \
              ./ "$DEPLOY_HOST:$APP_DIR/"
            $SSH "$DEPLOY_HOST" "cd $APP_DIR && docker compose up -d --build && docker image prune -f >/dev/null && docker compose ps"
          '''
        }
      }
    }

    stage('Verify deploy') {
      when {
        allOf {
          branch 'main'
          expression { params.DEPLOY }
        }
      }
      steps {
        sh '''
          for i in $(seq 1 20); do
            curl -fs "$PUBLIC_URL/health" && echo && exit 0
            sleep 3
          done
          echo "Health check failed at $PUBLIC_URL/health"; exit 1
        '''
      }
    }
  }

  post {
    success { echo "✅ Build ${env.BUILD_NUMBER} succeeded" }
    failure { echo "❌ Build ${env.BUILD_NUMBER} failed — see the stage logs above" }
    always  { sh 'rm -rf smoke-data' }
  }
}
