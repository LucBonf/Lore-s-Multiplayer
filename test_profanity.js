import filter from 'leo-profanity';

filter.loadDictionary('en');
filter.add(filter.list('it'));
filter.add(filter.list('fr'));
filter.add(filter.list('es'));

const tests = ["S****o", "C***o", "F**k", "Merde"];
tests.forEach(word => {
    console.log(`Word: ${word} - Profane: ${filter.check(word)}`);
});
