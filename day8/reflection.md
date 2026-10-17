# Reflection

The most difficult concept in the course was preventing race conditions when multiple people try to change the same data at once. A seat can look available to two buyers at the same time, so checking availability in the page is not enough. I understood the problem by following the competing requests step by step and learning how a database transaction, a conditional update, and a uniqueness constraint work together. I now understand that the database must be the source of truth for seat claims.

The only feedback I can currently see is my Day 8 score of 52%; I cannot see written comments explaining the deductions. Based on that result, I would improve the completeness and consistency of my capstone submission. In particular, I would check that every estimate states its assumptions, the API matches the data model, and the architecture explains how the system handles both peak load and failures. I would also compare every section directly against the rubric before submitting, rather than assuming that a technically sound idea is fully explained.

Next, I want to learn more about database transactions and distributed systems, then practice load testing and observability. Those skills would help me validate whether a design works under real traffic and identify problems before users encounter them.
