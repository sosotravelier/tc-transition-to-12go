# Developer Experience Review: PHP Integration

## Overall DX Assessment

This is the option that makes the most technical sense on paper and is the most challenging in practice. Direct MariaDB access eliminates latency. Zero new infrastructure is elegant. But you're asking .NET developers — whose expertise is in a different stack — to write PHP inside a large existing monolith during a major transition. The DX story here is a tale of two phases: a significant ramp-up followed by potentially strong long-term productivity. The question is how to manage the transition period effectively.

## Daily Workflow

The daily workflow starts with running the `frontend3` Docker environment — a large Symfony monolith with its own database, Redis, and services. This isn't `dotnet run` against a small project; it's spinning up someone else's world. The feedback loop for PHP changes is fast (no compilation), but the developer is navigating an unfamiliar codebase to understand which internal services to call and how. Every day starts with a context-switch tax: "I'm not in my ecosystem anymore." For the first 4-6 weeks, expect developers to spend as much time reading f3 code as writing B2B code.

## Code Writing Experience

PHP 8.3 with Symfony 6.4 is a perfectly decent development experience — readonly classes, enums, match expressions, attributes. The code structure (controllers, handlers, mappers) is clean and mirrors patterns the team knows conceptually. But "conceptually similar" and "muscle memory" are different things. The team will reach for `var`, write `=>` instead of `->`, forget semicolons, and fight with Composer instead of NuGet. AI assistance helps — Cursor generates reasonable PHP from C# descriptions — but the developer still needs to review code in a language where they can't spot bugs intuitively. You lose the "that looks wrong" instinct that 12 years of C# builds.

## Debugging Experience

This is the DX pain point. Xdebug is functional but miles behind Rider's .NET debugger in usability. Step-through debugging in a Symfony monolith involves understanding the kernel, event dispatcher, and service container. When something breaks, the PHP call stack includes Symfony internals the team doesn't understand. Error messages reference PHP concepts (opcache, type coercion, Doctrine proxy objects) that are foreign. Reproducing production issues means running the full f3 stack. The debugging experience alone could cost days during the initial weeks.

## Testing Experience

PHPUnit is mature and the mappers (pure functions) are easy to test. Functional tests using Symfony's test client work well. But the team needs to learn PHPUnit syntax, Symfony's test kernel bootstrap, and mocking patterns. Test infrastructure for f3 integration (database fixtures, service mocking) adds complexity. Test runs may be slower than they're used to because the f3 kernel is heavy. It's workable, but everything takes 50% longer than it would in .NET.

## Onboarding Assessment

For a .NET developer: 2-4 weeks to first meaningful contribution, assuming 12go veteran support. Without that veteran? Add another 2-3 weeks. The tribal knowledge requirement is high — f3's internal service layer is not self-documenting to outsiders. For a future 12go PHP developer inheriting this: excellent onboarding, code lives where they expect it. This option optimizes for the future maintainer at the expense of the current builder.

## Language/Framework Learning Curve

PHP syntax is learnable in days. Symfony's conventions take 1-2 weeks. The f3 codebase understanding takes 3-4 weeks minimum. The deepest mental shift: moving from "I own my service" to "I'm a guest in someone else's monolith." That's not a language shift — it's an autonomy shift, and it hits harder than any syntax difference.

## Joy Factor

Honest answer: low, at least initially. Developers chose .NET careers for a reason. Being told "write PHP now" during a period where they're already questioning their future at the company feels like a demotion, not an opportunity. Some developers will reframe it positively ("I'm learning the platform"), but that requires intrinsic motivation that can't be mandated. If the team resents this choice, velocity and quality will crater silently — no bugs in the tracker, just slower PRs, less initiative, and updated resumes.

The silver lining: if the team buys in, the deep integration with 12go's platform creates genuine ownership and understanding. Six months from now, these developers know the real system, not just a proxy layer.

## DX Risks

- **Morale collapse**: the single biggest risk. A team writing code under protest produces brittle, poorly-tested software.
- **12go veteran dependency**: without embedded PHP expertise, the team is lost in f3. If that person is pulled away, everything stalls.
- **Debugging black holes**: unfamiliar runtime errors in PHP/Symfony will consume disproportionate time.

## Recommendations

- Do not choose this option unless the team genuinely consents. "Feasible with AI" is not the same as "acceptable to humans."
- If chosen, embed the 12go veteran full-time for 6 weeks minimum. This is non-negotiable.
- Start with HTTP proxy endpoints (familiar pattern) before attempting direct service integration.
- Budget 30% more time than estimated for the DX tax of working in an unfamiliar ecosystem.

## Score Adjustments

The self-assessment's Team Competency Match of 2 is accurate but the downstream effects are underweighted. Development Velocity at 2 may be optimistic for the first 4 weeks — I'd score it 1 during ramp-up, 3 after. The design honestly acknowledges "the dominant risk is human, not technical." I agree completely. This option's score should carry an asterisk: *conditional on team willingness*.
