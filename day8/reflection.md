# Reflection

The most difficult concept in the course was a race condition: two buyers can see the same seat as available and try to claim it at nearly the same time. I worked through the requests step by step and learned why a page-level availability check is not enough. A conditional database update inside a transaction lets only one request change the seat from available to held; a uniqueness constraint provides another safeguard. Building the demo helped me explain the conflict from the buyer's point of view as well as the database's.

The feedback I received was a 58/100 Day 8 score, and I did not have written comments describing each deduction. The presentation rubric made the areas to improve clearer: I need to demonstrate the working flow and a graceful error, state the assumptions behind my traffic estimates, and connect each architecture component to a specific scaling problem. I revised the design around those points and added a browser demo that shows both a successful purchase and a competing hold conflict. The demo is a simulation, so it does not pretend to prove production database behavior.

Next, I want to learn how to build a small REST API backed by PostgreSQL, write transaction and concurrency tests, and then load-test it. That will help me verify that the design works beyond a presentation and understand how real systems behave under heavy traffic.
