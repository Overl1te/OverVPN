# Parallel image builds for CI (`docker buildx bake`).
variable "GIT_SHA" {
  default = ""
}

variable "CACHE_ROOT" {
  default = "/tmp/overvpn-buildx"
}

group "default" {
  targets = ["api", "web", "agent"]
}

target "docker-metadata-action" {}

target "api" {
  inherits = ["docker-metadata-action"]
  context    = "."
  dockerfile = "apps/api/Dockerfile"
  args = {
    OVERVPN_GIT_SHA = "${GIT_SHA}"
  }
  cache-from = ["type=local,src=${CACHE_ROOT}/api"]
  cache-to   = ["type=local,dest=${CACHE_ROOT}/api,mode=max"]
}

target "web" {
  inherits = ["docker-metadata-action"]
  context    = "."
  dockerfile = "apps/web/Dockerfile"
  cache-from = ["type=local,src=${CACHE_ROOT}/web"]
  cache-to   = ["type=local,dest=${CACHE_ROOT}/web,mode=max"]
}

target "agent" {
  inherits = ["docker-metadata-action"]
  context    = "."
  dockerfile = "deploy/agent/Dockerfile"
  args = {
    OVERVPN_GIT_SHA = "${GIT_SHA}"
  }
  cache-from = ["type=local,src=${CACHE_ROOT}/agent"]
  cache-to   = ["type=local,dest=${CACHE_ROOT}/agent,mode=max"]
}
