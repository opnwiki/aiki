// Node 20 does not yet implement the Set methods used by the project's
// Nuxt/Nitro dependency versions. Install the standard-compatible methods
// before starting the build process; Node 22+ keeps its native methods.
const setMethods = {
  difference(other) {
    const result = new Set(this)
    for (const value of other) result.delete(value)
    return result
  },
  intersection(other) {
    const result = new Set()
    const [smaller, larger] = this.size <= other.size ? [this, other] : [other, this]
    for (const value of smaller) if (larger.has(value)) result.add(value)
    return result
  },
  union(other) {
    const result = new Set(this)
    for (const value of other) result.add(value)
    return result
  },
  isSubsetOf(other) {
    if (this.size > other.size) return false
    for (const value of this) if (!other.has(value)) return false
    return true
  },
  isSupersetOf(other) {
    if (this.size < other.size) return false
    for (const value of other) if (!this.has(value)) return false
    return true
  },
  isDisjointFrom(other) {
    const [smaller, larger] = this.size <= other.size ? [this, other] : [other, this]
    for (const value of smaller) if (larger.has(value)) return false
    return true
  },
  symmetricDifference(other) {
    const result = new Set(this)
    for (const value of other) {
      if (result.has(value)) result.delete(value)
      else result.add(value)
    }
    return result
  },
}

for (const [name, method] of Object.entries(setMethods)) {
  if (typeof Set.prototype[name] !== 'function') {
    Object.defineProperty(Set.prototype, name, { configurable: true, writable: true, value: method })
  }
}
