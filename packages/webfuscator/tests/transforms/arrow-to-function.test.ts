import { expect, test } from 'vitest'

import { arrowToFunction } from '../../src/transforms/arrow-to-function'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('arrow-to-function', arrowToFunction, {
  specBlockBody: {
    name: 'arrowToFunction rewrites a block-bodied arrow as a function expression',
    input: `var fn = x => {
  return x + 1;
};`,
  },
  specThisCapture: {
    name: 'arrowToFunction hoists a _this alias when the arrow reads this',
    input: `var thisFn = function () {
  var read = () => {
    return this.x;
  };
  return read();
};`,
  },

  conciseBody: {
    name: 'arrowToFunction wraps a concise-body arrow with an explicit return',
    input: `var fn = x => x + 1;`,
  },
  conciseBodyNoArgs: {
    name: 'arrowToFunction handles a zero-arg concise-body arrow',
    input: `var fn = () => 42;`,
  },

  multipleThisRefs: {
    name: 'arrowToFunction reuses one _this alias across multiple this references',
    input: `function outer() {
  var read = () => {
    log(this.a);
    log(this.b);
    return this;
  };
  return read();
}`,
  },
  multipleArrowsSameEnv: {
    name: 'arrowToFunction reuses the same _this alias across two arrows that share an enclosing function',
    input: `function outer() {
  var f = () => this.a;
  var g = () => this.b;
  return [f(), g()];
}`,
  },
  arrowWithoutThis: {
    name: 'arrowToFunction does not hoist a _this when the arrow does not read this',
    input: `function outer() {
  var read = () => {
    return 1;
  };
  return read();
}`,
  },

  argumentsCapture: {
    name: 'arrowToFunction hoists an _arguments alias when the arrow reads arguments',
    input: `function outer() {
  var read = () => {
    return arguments[0];
  };
  return read();
}`,
  },

  newTargetCapture: {
    name: 'arrowToFunction hoists a _newtarget alias when the arrow reads new.target',
    input: `function Outer() {
  var read = () => {
    return new.target;
  };
  return read();
}`,
  },

  asyncArrow: {
    name: 'arrowToFunction preserves the async modifier when converting an async arrow',
    input: `var fn = async x => {
  return await load(x);
};`,
  },

  defaultParam: {
    name: 'arrowToFunction preserves a default parameter when converting',
    input: `var fn = (x = 1) => {
  return x;
};`,
  },
  restParam: {
    name: 'arrowToFunction preserves a rest parameter when converting',
    input: `var fn = (...rest) => {
  return rest;
};`,
  },

  noCaptures: {
    name: 'arrowToFunction converts a plain arrow with no captures cleanly',
    input: `var fn = (a, b) => {
  return a + b;
};`,
  },

  nestedArrowsBothCaptureThis: {
    name: 'arrowToFunction lifts a single _this when two nested arrows both read this',
    input: `function outer() {
  var read = () => {
    var inner = () => {
      return this.x;
    };
    return inner();
  };
  return read();
}`,
  },
})

test(cases.specBlockBody.name, () => {
  const out = run(cases.specBlockBody.input, arrowToFunction)
  expect(out).toContain('var fn = function (x)')
  expect(out).toContain('return x + 1')
  expect(out).not.toContain('=>')
})

test(cases.specThisCapture.name, () => {
  const out = run(cases.specThisCapture.input, arrowToFunction)
  expect(out).toMatch(/var _this = this/)
  expect(out).toMatch(/return _this\.x/)
  expect(out).not.toContain('=>')
})

test(cases.conciseBody.name, () => {
  const out = run(cases.conciseBody.input, arrowToFunction)
  expect(out).toContain('var fn = function (x)')
  expect(out).toContain('return x + 1')
})

test(cases.conciseBodyNoArgs.name, () => {
  const out = run(cases.conciseBodyNoArgs.input, arrowToFunction)
  expect(out).toContain('var fn = function ()')
  expect(out).toContain('return 42')
})

test(cases.multipleThisRefs.name, () => {
  const out = run(cases.multipleThisRefs.input, arrowToFunction)
  expect(out.match(/var _this = this/g)?.length).toBe(1)
  expect(out).toContain('_this.a')
  expect(out).toContain('_this.b')
  expect(out).toMatch(/return _this;/)
})

test(cases.multipleArrowsSameEnv.name, () => {
  const out = run(cases.multipleArrowsSameEnv.input, arrowToFunction)
  expect(out.match(/var _this = this/g)?.length).toBe(1)
  expect(out).toContain('return _this.a')
  expect(out).toContain('return _this.b')
})

test(cases.arrowWithoutThis.name, () => {
  const out = run(cases.arrowWithoutThis.input, arrowToFunction)
  expect(out).not.toContain('_this')
  expect(out).toContain('var read = function ()')
})

test(cases.argumentsCapture.name, () => {
  const out = run(cases.argumentsCapture.input, arrowToFunction)
  expect(out).toMatch(/var _arguments = arguments/)
  expect(out).toContain('_arguments[0]')
})

test(cases.newTargetCapture.name, () => {
  const out = run(cases.newTargetCapture.input, arrowToFunction)
  expect(out).toMatch(/var _newtarget = new\.target/)
  expect(out).toContain('return _newtarget')
})

test(cases.asyncArrow.name, () => {
  const out = run(cases.asyncArrow.input, arrowToFunction)
  expect(out).toMatch(/var fn = async function \(x\)/)
  expect(out).toContain('await load(x)')
})

test(cases.defaultParam.name, () => {
  const out = run(cases.defaultParam.input, arrowToFunction)
  expect(out).toContain('function (x = 1)')
})

test(cases.restParam.name, () => {
  const out = run(cases.restParam.input, arrowToFunction)
  expect(out).toContain('function (...rest)')
})

test(cases.noCaptures.name, () => {
  const out = run(cases.noCaptures.input, arrowToFunction)
  expect(out).toContain('var fn = function (a, b)')
  expect(out).toContain('return a + b')
})

test(cases.nestedArrowsBothCaptureThis.name, () => {
  const out = run(cases.nestedArrowsBothCaptureThis.input, arrowToFunction)
  expect(out.match(/var _this = this/g)?.length).toBe(1)
  expect(out).toContain('return _this.x')
  expect(out).not.toContain('=>')
})

function preservesArrow(code: string): void {
  expect(trace(run(code, arrowToFunction))).toEqual(trace(code))
}

test('arrowToFunction does not crash on a private-field arrow (F10)', () => {
  const out = run(
    'class C { #p = () => 1; run() { return this.#p(); } }\nlog(new C().run());',
    arrowToFunction,
  )
  expect(() => new Function(out)).not.toThrow()
  preservesArrow('class C { #p = () => 1; run() { return this.#p(); } }\nlog(new C().run());')
})

test('arrowToFunction preserves this in a static block (F11)', () => {
  preservesArrow('var out; class C { static { var f = () => this; out = f() === C; } }\nlog(out);')
})

test('arrowToFunction preserves this in a parameter default (F13)', () => {
  preservesArrow('function f(g = (() => this)()) { return g; }\nlog(f.call({ q: 1 }).q);')
})

test('arrowToFunction preserves reassigned arguments (F14)', () => {
  preservesArrow('function f() { arguments = 5; var g = () => arguments; return g(); }\nlog(f(1));')
})

test('arrowToFunction preserves arrow non-constructibility when observed (F15)', () => {
  preservesArrow(
    'var f = (a) => a + 1;\nlog(typeof f.prototype);\ntry { new f(); log("constructed"); } catch (e) { log(e.constructor.name); }',
  )
})

test('arrowToFunction leaves an arrow whose prototype is read through bracket access (A10-08)', () => {
  preservesArrow('var f = () => 1;\nlog(typeof f["prototype"]);')
})

test('arrowToFunction leaves an arrow passed as a call argument (A10-09)', () => {
  preservesArrow(
    'function make(g) { try { new g(); log("constructed"); } catch (e) { log("threw"); } }\nmake(() => 1);',
  )
})

test('arrowToFunction leaves an arrow reached by Reflect.construct (A10-09)', () => {
  preservesArrow(
    'var A = () => 1;\ntry { Reflect.construct(A, []); log("ok"); } catch (e) { log("threw"); }',
  )
})

test('arrowToFunction leaves an arrow used as a class extends operand (A10-10)', () => {
  preservesArrow(
    'try { var C = class extends (() => {}) {}; log("ok"); } catch (e) { log("threw"); }',
  )
  preservesArrow(
    'var A = () => {};\ntry { class B extends A {} log("ok"); } catch (e) { log("threw"); }',
  )
})

test('arrowToFunction leaves an arrow inside a computed class-member key (A10-11)', () => {
  preservesArrow(
    'function build() { var C = class { [(() => this.k)()]() { return 7; } }; return new C(); }\nlog(typeof build.call({ k: "mm" }));',
  )
  preservesArrow(
    'function build() { var C = class { [(() => arguments[0])()]() { return 7; } }; return new C(); }\nlog(typeof build("mm"));',
  )
})

test('arrowToFunction leaves an arrow whose capture alias a with object could shadow (A10-12)', () => {
  preservesArrow(
    'function outer() { var o = { _this: { tag: "hijacked" } }; with (o) { var f = () => this.tag; return f(); } }\nlog(outer.call({ tag: "real" }));',
  )
  preservesArrow(
    'function f() { var o = { _arguments: ["hijacked"] }; with (o) { var g = () => arguments[0]; return g(); } }\nlog(f("real"));',
  )
})

test('arrowToFunction leaves an arrow whose this is read by a direct eval (A10-13)', () => {
  preservesArrow(
    'function outer() { var g = () => eval("this.tag"); return g.call({ tag: "inner" }); }\nlog(outer.call({ tag: "outer" }));',
  )
})

test('arrowToFunction leaves an arrow when arguments is rebound by destructuring (A10-14)', () => {
  preservesArrow(
    'function f() { var g = () => arguments; [arguments] = ["X"]; return g(); }\nlog(f(1));',
  )
})

test('arrowToFunction leaves an arrow that escapes through an array literal', () => {
  preservesArrow(
    'var fns = [() => 1];\ntry { new fns[0](); log("constructed"); } catch (e) { log("threw"); }',
  )
})

test('arrowToFunction leaves an arrow returned out of its function', () => {
  preservesArrow(
    'function make() { return () => 1; }\ntry { new (make())(); log("constructed"); } catch (e) { log("threw"); }',
  )
})

test('arrowToFunction leaves an arrow assigned to a member', () => {
  preservesArrow(
    'var o = {};\no.f = () => 1;\ntry { new o.f(); log("constructed"); } catch (e) { log("threw"); }',
  )
})

test('arrowToFunction leaves an arrow reached through Function.prototype.bind', () => {
  preservesArrow(
    'var f = () => 1;\nvar b = f.bind(null);\ntry { new b(); log("constructed"); } catch (e) { log("threw"); }',
  )
})

test('arrowToFunction leaves an arrow held by a reassigned binding', () => {
  preservesArrow(
    'var f = () => 1;\nf = f;\ntry { new f(); log("constructed"); } catch (e) { log("threw"); }',
  )
})
