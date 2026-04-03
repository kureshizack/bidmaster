/**
 * CaptainXI Player Career Stats — cxi-player-stats.js
 * ────────────────────────────────────────────────────
 * Aggregates career batting + bowling stats from the `balls` table
 * across ALL matches (standalone + tournament).
 * 
 * USAGE in player.html:
 *   <script src="cxi-player-stats.js"></script>
 *   const stats = await CXIPlayerStats.getCareerStats(playerName, supabaseClient);
 * 
 * IMPORTANT: This replaces any existing career stats logic in player.html.
 * The `balls` table is the single source of truth — not match_players.
 */

const CXIPlayerStats = (() => {

    /**
     * Get complete career stats for a player.
     * @param {string} playerName - exact name as stored in balls table
     * @param {object} sb - Supabase client
     * @returns {object} { batting, bowling, fielding, matches, summary }
     */
    async function getCareerStats(playerName, sb) {
        const [battingRaw, bowlingRaw, fieldingRaw, matchList] = await Promise.all([
            getBattingBalls(playerName, sb),
            getBowlingBalls(playerName, sb),
            getFieldingDismissals(playerName, sb),
            getMatchesPlayed(playerName, sb)
        ]);

        const batting = aggregateBatting(battingRaw);
        const bowling = aggregateBowling(bowlingRaw);
        const fielding = aggregateFielding(fieldingRaw);
        const matches = matchList;

        const summary = {
            totalMatches: matches.length,
            ...batting.career,
            ...bowling.career,
            catches: fielding.catches,
            runouts: fielding.runouts,
            stumpings: fielding.stumpings
        };

        return { batting, bowling, fielding, matches, summary };
    }

    // ─── Raw data fetchers ───

    async function getBattingBalls(name, sb) {
        // All balls where this player was the batter
        const { data, error } = await sb
            .from('balls')
            .select('match_id, innings, over_number, ball_number, runs, extras, extra_type, is_wicket, dismissal_type, batter_name')
            .eq('batter_name', name)
            .order('match_id')
            .order('innings')
            .order('over_number')
            .order('ball_number');

        if (error) { console.error('[CXI-Stats] Batting fetch error:', error); return []; }
        return data || [];
    }

    async function getBowlingBalls(name, sb) {
        // All balls where this player was the bowler
        const { data, error } = await sb
            .from('balls')
            .select('match_id, innings, over_number, ball_number, runs, extras, extra_type, is_wicket, dismissal_type, bowler_name')
            .eq('bowler_name', name)
            .order('match_id')
            .order('innings')
            .order('over_number')
            .order('ball_number');

        if (error) { console.error('[CXI-Stats] Bowling fetch error:', error); return []; }
        return data || [];
    }

    async function getFieldingDismissals(name, sb) {
        // Balls where this player took a catch, ran out, or stumped
        const { data, error } = await sb
            .from('balls')
            .select('match_id, dismissal_type, fielder_name')
            .eq('fielder_name', name)
            .eq('is_wicket', true);

        if (error) { console.error('[CXI-Stats] Fielding fetch error:', error); return []; }
        return data || [];
    }

    async function getMatchesPlayed(name, sb) {
        // Get unique match IDs where player appeared as batter or bowler
        const { data: batMatches } = await sb
            .from('balls')
            .select('match_id')
            .eq('batter_name', name);

        const { data: bowlMatches } = await sb
            .from('balls')
            .select('match_id')
            .eq('bowler_name', name);

        const allIds = new Set([
            ...(batMatches || []).map(r => r.match_id),
            ...(bowlMatches || []).map(r => r.match_id)
        ]);

        if (allIds.size === 0) return [];

        // Fetch match details
        const { data: matches } = await sb
            .from('matches')
            .select('id, team1_name, team2_name, match_date, venue, result, tournament_id, status')
            .in('id', Array.from(allIds))
            .order('match_date', { ascending: false });

        return matches || [];
    }

    // ─── Aggregation: Batting ───

    function aggregateBatting(balls) {
        if (!balls.length) return { career: defaultBattingCareer(), byMatch: [] };

        const byMatch = {};

        for (const b of balls) {
            const mid = b.match_id;
            if (!byMatch[mid]) byMatch[mid] = {
                matchId: mid, innings: b.innings,
                runs: 0, balls: 0, fours: 0, sixes: 0,
                isOut: false, dismissalType: null
            };

            const m = byMatch[mid];
            const batsmanRuns = b.runs || 0;

            // Only count runs scored by bat (exclude extras like wides, no-balls to bowler)
            // Wide doesn't count as a ball faced. No-ball doesn't count as a ball faced.
            const isWide = b.extra_type === 'wide';
            const isNoBall = b.extra_type === 'noball';

            if (!isWide) {
                m.balls += 1; // Ball faced (no-balls count as balls faced in some formats — adjust if needed)
            }

            // Runs scored by batsman (not extras)
            m.runs += batsmanRuns;
            if (batsmanRuns === 4) m.fours++;
            if (batsmanRuns === 6) m.sixes++;

            if (b.is_wicket && b.dismissal_type !== 'retired') {
                m.isOut = true;
                m.dismissalType = b.dismissal_type;
            }
        }

        const matchStats = Object.values(byMatch);

        // Career aggregation
        let totalRuns = 0, totalBalls = 0, totalFours = 0, totalSixes = 0;
        let totalInnings = matchStats.length, totalOuts = 0;
        let highScore = 0, highScoreNotOut = false;
        let fifties = 0, hundreds = 0, ducks = 0;
        let thirties = 0; // 30+ scores

        for (const m of matchStats) {
            totalRuns += m.runs;
            totalBalls += m.balls;
            totalFours += m.fours;
            totalSixes += m.sixes;
            if (m.isOut) totalOuts++;

            if (m.runs > highScore || (m.runs === highScore && !m.isOut)) {
                highScore = m.runs;
                highScoreNotOut = !m.isOut;
            }

            if (m.runs >= 100) hundreds++;
            else if (m.runs >= 50) fifties++;
            if (m.runs >= 30 && m.runs < 50) thirties++;
            if (m.runs === 0 && m.isOut && m.balls > 0) ducks++;
        }

        const average = totalOuts > 0 ? (totalRuns / totalOuts) : (totalRuns > 0 ? totalRuns : 0);
        const strikeRate = totalBalls > 0 ? ((totalRuns / totalBalls) * 100) : 0;

        return {
            career: {
                bat_innings: totalInnings,
                bat_runs: totalRuns,
                bat_balls: totalBalls,
                bat_average: Math.round(average * 100) / 100,
                bat_sr: Math.round(strikeRate * 100) / 100,
                bat_fours: totalFours,
                bat_sixes: totalSixes,
                bat_high: highScore + (highScoreNotOut ? '*' : ''),
                bat_50s: fifties,
                bat_100s: hundreds,
                bat_30s: thirties,
                bat_ducks: ducks,
                bat_notouts: totalInnings - totalOuts
            },
            byMatch: matchStats
        };
    }

    function defaultBattingCareer() {
        return {
            bat_innings: 0, bat_runs: 0, bat_balls: 0, bat_average: 0, bat_sr: 0,
            bat_fours: 0, bat_sixes: 0, bat_high: '-', bat_50s: 0, bat_100s: 0,
            bat_30s: 0, bat_ducks: 0, bat_notouts: 0
        };
    }

    // ─── Aggregation: Bowling ───

    function aggregateBowling(balls) {
        if (!balls.length) return { career: defaultBowlingCareer(), byMatch: [] };

        const byMatch = {};

        for (const b of balls) {
            const mid = b.match_id;
            if (!byMatch[mid]) byMatch[mid] = {
                matchId: mid, innings: b.innings,
                balls: 0, runs: 0, wickets: 0, maidenOvers: {},
                wides: 0, noballs: 0, dotBalls: 0
            };

            const m = byMatch[mid];
            const isWide = b.extra_type === 'wide';
            const isNoBall = b.extra_type === 'noball';

            // Legal deliveries for bowling
            if (!isWide && !isNoBall) {
                m.balls += 1;
            }

            // Total runs conceded (bat runs + extras from this delivery)
            const runsConceded = (b.runs || 0) + (b.extras || 0);
            m.runs += runsConceded;

            if (isWide) m.wides++;
            if (isNoBall) m.noballs++;

            // Dot ball: 0 runs conceded on a legal delivery
            if (!isWide && !isNoBall && runsConceded === 0 && !b.is_wicket) {
                m.dotBalls++;
            }

            // Wickets (exclude run-outs — not credited to bowler)
            if (b.is_wicket && b.dismissal_type !== 'runout' && b.dismissal_type !== 'retired') {
                m.wickets++;
            }

            // Track overs for maiden calculation
            const overKey = `${b.innings}-${b.over_number}`;
            if (!m.maidenOvers[overKey]) m.maidenOvers[overKey] = { runs: 0, legal: 0 };
            m.maidenOvers[overKey].runs += runsConceded;
            if (!isWide && !isNoBall) m.maidenOvers[overKey].legal++;
        }

        const matchStats = Object.values(byMatch);

        let totalBalls = 0, totalRuns = 0, totalWickets = 0, totalMaidens = 0;
        let totalDots = 0, totalWides = 0, totalNoBalls = 0;
        let bestFigWickets = 0, bestFigRuns = 999;
        let threeWickets = 0, fiveWickets = 0;
        let totalInnings = matchStats.length;

        for (const m of matchStats) {
            totalBalls += m.balls;
            totalRuns += m.runs;
            totalWickets += m.wickets;
            totalDots += m.dotBalls;
            totalWides += m.wides;
            totalNoBalls += m.noballs;

            // Maidens
            for (const ov of Object.values(m.maidenOvers)) {
                if (ov.runs === 0 && ov.legal >= 6) totalMaidens++;
            }

            // Best figures
            if (m.wickets > bestFigWickets || (m.wickets === bestFigWickets && m.runs < bestFigRuns)) {
                bestFigWickets = m.wickets;
                bestFigRuns = m.runs;
            }

            if (m.wickets >= 3) threeWickets++;
            if (m.wickets >= 5) fiveWickets++;
        }

        const overs = Math.floor(totalBalls / 6) + (totalBalls % 6) / 10;
        const economy = totalBalls > 0 ? (totalRuns / (totalBalls / 6)) : 0;
        const average = totalWickets > 0 ? (totalRuns / totalWickets) : 0;
        const sr = totalWickets > 0 ? (totalBalls / totalWickets) : 0;

        return {
            career: {
                bowl_innings: totalInnings,
                bowl_overs: parseFloat(overs.toFixed(1)),
                bowl_balls: totalBalls,
                bowl_runs: totalRuns,
                bowl_wickets: totalWickets,
                bowl_average: Math.round(average * 100) / 100,
                bowl_economy: Math.round(economy * 100) / 100,
                bowl_sr: Math.round(sr * 100) / 100,
                bowl_maidens: totalMaidens,
                bowl_best: totalWickets > 0 ? `${bestFigWickets}/${bestFigRuns}` : '-',
                bowl_3w: threeWickets,
                bowl_5w: fiveWickets,
                bowl_dots: totalDots,
                bowl_wides: totalWides,
                bowl_noballs: totalNoBalls
            },
            byMatch: matchStats
        };
    }

    function defaultBowlingCareer() {
        return {
            bowl_innings: 0, bowl_overs: 0, bowl_balls: 0, bowl_runs: 0, bowl_wickets: 0,
            bowl_average: 0, bowl_economy: 0, bowl_sr: 0, bowl_maidens: 0, bowl_best: '-',
            bowl_3w: 0, bowl_5w: 0, bowl_dots: 0, bowl_wides: 0, bowl_noballs: 0
        };
    }

    // ─── Aggregation: Fielding ───

    function aggregateFielding(dismissals) {
        let catches = 0, runouts = 0, stumpings = 0;
        for (const d of dismissals) {
            if (d.dismissal_type === 'caught') catches++;
            else if (d.dismissal_type === 'runout') runouts++;
            else if (d.dismissal_type === 'stumped') stumpings++;
        }
        return { catches, runouts, stumpings, total: catches + runouts + stumpings };
    }

    // ─── Search players by partial name ───
    async function searchPlayers(query, sb, limit = 20) {
        // Search across balls table for unique player names
        const { data: batters } = await sb
            .from('balls')
            .select('batter_name')
            .ilike('batter_name', `%${query}%`)
            .limit(100);

        const { data: bowlers } = await sb
            .from('balls')
            .select('bowler_name')
            .ilike('bowler_name', `%${query}%`)
            .limit(100);

        const names = new Set();
        (batters || []).forEach(r => names.add(r.batter_name));
        (bowlers || []).forEach(r => names.add(r.bowler_name));

        // Sort alphabetically, limit results
        return Array.from(names).sort().slice(0, limit);
    }

    // ─── Get recent form (last N innings) ───
    async function getRecentForm(playerName, sb, lastN = 5) {
        const { data } = await sb
            .from('balls')
            .select('match_id, runs, is_wicket')
            .eq('batter_name', playerName)
            .order('created_at', { ascending: false });

        if (!data || !data.length) return [];

        // Group by match, take last N
        const byMatch = {};
        for (const b of data) {
            if (!byMatch[b.match_id]) byMatch[b.match_id] = { runs: 0, out: false };
            byMatch[b.match_id].runs += b.runs || 0;
            if (b.is_wicket) byMatch[b.match_id].out = true;
        }

        return Object.values(byMatch).slice(0, lastN).map(m =>
            m.runs + (m.out ? '' : '*')
        );
    }

    // ─── Public API ───
    return {
        getCareerStats,
        searchPlayers,
        getRecentForm,
        // Expose individual aggregators for testing
        _aggregateBatting: aggregateBatting,
        _aggregateBowling: aggregateBowling,
        _aggregateFielding: aggregateFielding
    };
})();
