# Temporary work in a day plan

When planning from a new update, dAIly first checks for explicitly mentioned unfinished work outside saved goal subtasks. It proposes editable titles, total effort estimates, and due dates. Quotes from the update validate that suggestions refer to supplied text. Missing estimates must be supplied before confirmation.

Confirmation embeds the work in a proposed plan. It never inserts a goal or a task record. The planner then proposes a complete schedule for a separate Apply plan action. Confirmed work must be scheduled or explicitly deferred; urgent deadlines influence ordering. The scheduler places blocks around commitments, inserts breaks, and divides temporary work into preferred focus lengths. Partial allocations remain visible with the remaining effort deferred.

Focus sessions reference the embedded task ID. Reported outcomes remain in session history, with unassigned goal attribution. Temporary work expires at the confirmed planning cutoff, including after-midnight cutoffs. Old plans remain historical records and are not silently carried into another day.

Clear plan supersedes open schedules and removes their temporary work from the active planning context. It invalidates pending results and preserves goals, original plans, and reported sessions. A current session must finish and receive an outcome first.

New-update planning uses an extra local model request for discovery. One local Gemma evaluation of the assignment scenario detected a one-hour assignment due tomorrow, then proposed assignment, break, and Dynamic Programming after confirmation. The warm discovery took about 3.2 seconds and subsequent planning about 11.3 seconds on this Ubuntu laptop. This single scenario does not establish reliability for every wording or laptop. Unsupported or invalid output leaves the existing plan intact.
