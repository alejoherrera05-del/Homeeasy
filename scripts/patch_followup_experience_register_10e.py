from pathlib import Path

path = Path('hommy_backend/followup_experience.py')
source = path.read_text(encoding='utf-8')
old = '''    register = "UNKNOWN"\n    if usted_score >= tu_score + 2 and usted_score >= 2:\n        register = "USTED"\n    elif tu_score >= usted_score + 2 and tu_score >= 2:\n        register = "TU"\n'''
new = '''    register = "UNKNOWN"\n    if honorific_observed and tu_score == 0:\n        # An observed don/doña/señor/señora is itself strong evidence that the\n        # relationship is being handled respectfully. Do not downgrade it merely\n        # because the recent sentence omitted the literal pronoun "usted".\n        register = "USTED"\n    elif usted_score >= tu_score + 2 and usted_score >= 2:\n        register = "USTED"\n    elif tu_score >= usted_score + 2 and tu_score >= 2:\n        register = "TU"\n'''
if source.count(old) != 1:
    raise SystemExit(f'register block mismatch: {source.count(old)}')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
