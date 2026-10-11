"""Authoritative Block Cash simulation shared by local and hosted APIs. No payments."""
import copy
import secrets

SHAPES = [((0,0),), ((0,0),(1,0)), ((0,0),(0,1)), ((0,0),(1,0),(2,0)),
          ((0,0),(0,1),(0,2)), ((0,0),(1,0),(0,1)), ((0,0),(1,0),(1,1)),
          ((0,0),(0,1),(1,1)), ((1,0),(0,1),(1,1)), ((0,0),(1,0),(2,0),(3,0)),
          ((0,0),(0,1),(0,2),(0,3)), ((0,0),(1,0),(2,0),(0,1)),
          ((0,0),(1,0),(2,0),(2,1)), ((0,0),(1,0),(0,1),(1,1)),
          ((0,0),(1,0),(2,0),(1,1)), ((0,0),(1,0),(2,0),(0,1),(1,1),(2,1)),
          ((0,0),(1,0),(0,1),(1,1),(0,2),(1,2))]

def pieces(state):
    low = min(16, (3 if state['turn'] < 5 else 5 if state['turn'] < 12 else 9) + state['difficulty'])
    high = max(low, min(16, 12 + state['turn']//3 + state['difficulty']*2))
    return [{'id':i,'shape':SHAPES[low+secrets.randbelow(high-low+1)],'color':secrets.choice(['cyan','yellow','purple','green','orange']),'used':False} for i in range(3)]

def new_game(entry):
    if type(entry) is not int or entry not in (500,1000,2500,5000):
        raise ValueError('Escolha 5, 10, 25 ou 50 fichas virtuais.')
    state = dict(id=secrets.token_urlsafe(18), revision=0, entry=entry, board=[None]*64,
                 turn=0, difficulty=0, combo=0, score=0, amount=0, lastClear=0,
                 lastCashGain=0, status='active', virtualResult=0, mode='demo')
    state['pieces'] = pieces(state)
    return state

def fits(board, shape, x, y):
    return all(0 <= x+dx < 8 and 0 <= y+dy < 8 and not board[(y+dy)*8+x+dx] for dx,dy in shape)

def advance(current, action, data):
    if current['status'] != 'active':
        raise ValueError('Esta partida já foi encerrada.')
    state = copy.deepcopy(current)
    if action == 'finish':
        if state['amount'] < state['entry']:
            raise ValueError('A meta virtual ainda não foi atingida.')
        state['status'] = 'completed'
        state['virtualResult'] = state['entry'] + state['amount']
    elif action == 'move':
        index, x, y = data.get('piece'), data.get('x'), data.get('y')
        if any(type(v) is not int for v in (index,x,y)) or not 0 <= index < 3:
            raise ValueError('Jogada inválida.')
        piece = state['pieces'][index]
        if piece['used'] or not fits(state['board'], piece['shape'], x, y):
            raise ValueError('A peça não cabe nessa posição ou já foi usada.')
        for dx,dy in piece['shape']:
            state['board'][(y+dy)*8+x+dx] = piece['color']
        piece['used'] = True
        state['turn'] += 1
        rows = [y for y in range(8) if all(state['board'][y*8+x] for x in range(8))]
        cols = [x for x in range(8) if all(state['board'][y*8+x] for y in range(8))]
        lines = len(rows)+len(cols)
        state['lastClear'], state['lastCashGain'] = lines, 0
        state['combo'] = state['combo']+1 if lines else 0
        for y in rows:
            for x in range(8): state['board'][y*8+x] = None
        for x in cols:
            for y in range(8): state['board'][y*8+x] = None
        if lines:
            state['score'] += lines*100*state['combo']
            state['lastCashGain'] = lines*([50,100,100,100,125,125][min(state['combo']-1,5)] + state['difficulty']*25)
            state['amount'] += state['lastCashGain']
            if state['combo'] % 6 == 0: state['difficulty'] += 1
        if all(p['used'] for p in state['pieces']): state['pieces'] = pieces(state)
        if not any(not p['used'] and fits(state['board'],p['shape'],x,y) for p in state['pieces'] for x in range(8) for y in range(8)):
            state['status'] = 'lost'
    else:
        raise ValueError('Ação inválida.')
    state['revision'] += 1
    return state
